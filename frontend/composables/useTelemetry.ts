/**
 * useTelemetry — thin façade that forwards events to the operator.
 *
 * The operator owns the SQLite store and the shipping loop. This file just
 * translates track*() calls into `telemetry.event` requests and exposes
 * consent state. Rationale:
 *   - No @tauri-apps/plugin-sql IPC from the webview (browser mode broke).
 *   - No CORS surface on telemetry-api (server-to-server call now).
 *   - Operator already has the bearer token and OS info.
 *
 * Public shape intentionally preserved so call sites (MainShell, spaces,
 * PrivacySettings) don't need to change.
 */
import { isTauriEnv } from '@/utils/tauri'

const CONSENT_KEY = 'construct_telemetry_consent'

// ─── Consent ────────────────────────────────────────────────────────────────

export type TelemetryConsent = 'off' | 'anonymous' | 'identified'

export function getTelemetryConsent(): TelemetryConsent {
  if (typeof globalThis.localStorage?.getItem !== 'function') return 'anonymous'
  const v = globalThis.localStorage.getItem(CONSENT_KEY)
  if (v === 'off' || v === 'anonymous' || v === 'identified') return v
  return 'anonymous'
}

export function setTelemetryConsent(consent: TelemetryConsent) {
  if (typeof globalThis.localStorage?.setItem === 'function') {
    globalThis.localStorage.setItem(CONSENT_KEY, consent)
  }
  import('@/composables/useTauriStore').then(({ getTauriStore }) =>
    getTauriStore().then(s => s?.set(CONSENT_KEY, consent))
  ).catch(() => {})
}

export function isTelemetryEnabled(): boolean {
  return getTelemetryConsent() !== 'off'
}

// ─── Operator bridge ────────────────────────────────────────────────────────

// Single emit path: every track*() ends here. Fire-and-forget — the
// operator will log its own failures and no one cares enough at the call
// site to await a record.
async function emit(kind: string, data: Record<string, unknown>): Promise<void> {
  if (!isTelemetryEnabled()) return
  if (!isTauriEnv()) return
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    await invoke('send_context_request', {
      requestType: 'telemetry.event',
      payload: { kind, data },
    })
  } catch {
    // Silent — telemetry must never break the app.
  }
}

async function sendOperator<T = Record<string, unknown>>(
  requestType: string,
  payload: Record<string, unknown> = {},
): Promise<T | null> {
  if (!isTauriEnv()) return null
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    let result = await invoke<T>('send_context_request', { requestType, payload })
    if (typeof result === 'string') {
      try { result = JSON.parse(result) } catch { /* not JSON */ }
    }
    return result
  } catch {
    return null
  }
}

// ─── Tracking functions ─────────────────────────────────────────────────────

export async function trackSessionStart(): Promise<void> {
  await emit('usage', { sessions: 1 })
}

export async function trackSessionEnd(): Promise<void> {
  // Operator flushes on its own interval + on shutdown; no client-side sync
  // needed. Left as a no-op so callers can keep the symmetry with start.
}

export async function trackScreenView(_routeName: string, _spaceId?: string): Promise<void> {
  // Screen views rolled into space enter counts — handled by trackSpaceEnter.
}

export async function trackSpaceEnter(spaceId: string): Promise<void> {
  if (!spaceId) return
  await emit('space', { space_id: spaceId, enter_count: 1 })
}

export async function trackSpaceLeave(spaceId: string, activeMs: number): Promise<void> {
  if (!spaceId) return
  const minutes = Math.round(activeMs / 60000)
  if (minutes <= 0) return
  await emit('usage', { active_minutes: minutes })
  await emit('space', { space_id: spaceId, active_minutes: minutes })
}

export async function trackChat(): Promise<void> {
  await emit('usage', { chats_sent: 1 })
}

export async function trackFileSave(): Promise<void> {
  await emit('usage', { file_saves: 1 })
}

export async function trackGitCommit(): Promise<void> {
  await emit('usage', { git_commits: 1 })
}

export async function trackError(): Promise<void> {
  await emit('usage', { errors: 1 })
}

export interface AiUsage {
  provider?: string
  model: string
  tokensInput: number
  tokensOutput: number
  cacheRead?: number
  cacheWrite?: number
  toolCalls?: number
  costUsd?: number
}

export async function trackAiUsage(usage: AiUsage): Promise<void> {
  if (!usage.model) return
  const tokIn = usage.tokensInput | 0
  const tokOut = usage.tokensOutput | 0
  const tools = usage.toolCalls || 0
  await emit('usage', { tokens_input: tokIn, tokens_output: tokOut, tool_calls: tools })
  await emit('model', {
    provider: usage.provider || 'unknown',
    model: usage.model,
    request_count: 1,
    tokens_input: tokIn,
    tokens_output: tokOut,
    cache_read: usage.cacheRead || 0,
    cache_write: usage.cacheWrite || 0,
    tool_calls: tools,
    cost_usd: usage.costUsd || 0,
  })
}

export async function trackToolCall(toolName: string, success: boolean, ms: number): Promise<void> {
  if (!toolName) return
  await emit('tool', {
    tool_name: toolName,
    invocations: 1,
    success_count: success ? 1 : 0,
    error_count: success ? 0 : 1,
    total_ms: Math.max(0, Math.round(ms)),
  })
}

export async function trackErrorClass(errorClass: string): Promise<void> {
  if (!errorClass) return
  await emit('usage', { errors: 1 })
  await emit('error', { error_class: errorClass, count: 1 })
}

export interface ErrorEventPayload {
  errorClass: string
  message?: string
  stack?: string
  source?: string  // frontend | operator | desktop — defaults to frontend
}

const HOME_PATH_RE = /(\/Users\/[^/\s)]+|\/home\/[^/\s)]+|[A-Z]:\\Users\\[^\\\s)]+|[A-Z]:\/Users\/[^/\s)]+)/gi
const MESSAGE_MAX = 500
const STACK_MAX = 4000

// Secret patterns to strip before anything leaves the device. Error
// messages routinely embed the URL/headers that failed, so a 401 or a bad
// request can carry a live token. Redact those (and the home path) for both
// message and stack — telemetry should never receive credentials.
const SECRET_RES: Array<[RegExp, string]> = [
  // Construct-issued tokens: cat_/csk_/cst_ (+ optional _live_) prefixes.
  [/\b(c(?:at|sk|st))_(?:live_)?[A-Za-z0-9._-]{8,}/g, '$1_<REDACTED>'],
  // Anthropic / OpenAI style keys.
  [/\bsk-[A-Za-z0-9-]{12,}/g, 'sk-<REDACTED>'],
  // Bearer tokens in any header dump.
  [/\b([Bb]earer)\s+[A-Za-z0-9._~+/-]{8,}=*/g, '$1 <REDACTED>'],
  // Sensitive query params: token / access_token / refresh_token / api_key / code.
  [/([?&](?:access_token|refresh_token|token|api_key|apikey|code|client_secret)=)[^&\s"']+/gi, '$1<REDACTED>'],
]

export function redactSecrets(s: string): string {
  let out = s.replace(HOME_PATH_RE, '<HOME>')
  for (const [re, rep] of SECRET_RES) out = out.replace(re, rep)
  return out
}

function sanitizeStack(s: string): string {
  return redactSecrets(s).slice(0, STACK_MAX)
}

// trackErrorEvent ships an individual error report with stack to the
// operator → telemetry-api `/api/errors`. Sits alongside the existing
// trackErrorClass aggregate counter — both fire on the same event so the
// daily_errors rollup stays accurate while error_events gets the detail.
//
// Privacy: same isTelemetryEnabled gate as everything else. Message is
// truncated to 500 chars; stack to 4000. User home paths are normalized
// to <HOME> client-side; the server does it again as a defense in depth.
export async function trackErrorEvent(p: ErrorEventPayload): Promise<void> {
  if (!p.errorClass) return
  if (!isTelemetryEnabled()) return
  if (!isTauriEnv()) return
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    await invoke('send_context_request', {
      requestType: 'telemetry.error_event',
      payload: {
        source: p.source || 'frontend',
        severity: 'error',
        error_class: p.errorClass,
        message: redactSecrets(p.message || '').slice(0, MESSAGE_MAX),
        stack: sanitizeStack(p.stack || ''),
      },
    })
  } catch {
    // Best-effort — telemetry must never break the app.
  }
}

export async function trackPerf(metric: string, durationMs: number): Promise<void> {
  if (!metric) return
  const ms = Math.round(durationMs)
  if (ms <= 0) return
  await emit('perf', { metric, count: 1, total_ms: ms, min_ms: ms, max_ms: ms })
}

// Kept for backward compat — maps common feature keys to the specific
// trackers above, everything else falls through as a generic chat counter.
export async function trackFeature(key: string): Promise<void> {
  if (key === 'ai.chat.sent') return trackChat()
  if (key === 'code.file.save') return trackFileSave()
  if (key === 'git.commit.made') return trackGitCommit()
  await trackChat()
}

// ─── Data access (for settings page) ────────────────────────────────────────

export async function getStoredData(): Promise<{ sessions: number; spaces: number; dateRange: string } | null> {
  const res = await sendOperator<{ sessions: number; spaces: number; date_range: string }>('telemetry.stats')
  if (!res) return null
  return {
    sessions: res.sessions || 0,
    spaces: res.spaces || 0,
    dateRange: res.date_range || '',
  }
}

export async function clearStoredData(): Promise<void> {
  await sendOperator('telemetry.clear')
}

// syncToApi / syncDevice kept as no-ops so legacy callers don't throw —
// the operator owns sync cadence now.
export async function syncToApi(): Promise<void> { /* operator-owned */ }
export async function syncDevice(): Promise<void> { /* operator-owned */ }

// ─── Composable ─────────────────────────────────────────────────────────────

export function useTelemetry() {
  return {
    get isEnabled() { return isTelemetryEnabled() },
    get consent() { return getTelemetryConsent() },
    setConsent: setTelemetryConsent,
    trackSessionStart,
    trackSessionEnd,
    trackScreenView,
    trackSpaceEnter,
    trackSpaceLeave,
    trackChat,
    trackFileSave,
    trackGitCommit,
    trackError,
    trackErrorClass,
    trackAiUsage,
    trackToolCall,
    trackPerf,
    trackFeature,
    getStoredData,
    clearStoredData,
    syncToApi,
    syncDevice,
  }
}
