/**
 * useTelemetry — Anonymous product telemetry (Phase 1)
 *
 * SQLite-backed aggregate telemetry. No PII, no event logs — just counters.
 * Consent stored in localStorage (sync access). Data in SQLite via tauri-plugin-sql.
 * Background API sync on session start/end — silent, non-blocking.
 */

import { appConfig } from '@/utils/config'

// ─── Constants ───────────────────────────────────────────────────────────────

const CONSENT_KEY = 'construct_telemetry_consent'
const DB_NAME = 'sqlite:telemetry.db'

export const TELEMETRY_FEATURE_KEYS = [
  'ai.chat.sent',
  'ai.chat.regenerate',
  'code.file.open',
  'code.file.save',
  'code.terminal.open',
  'design.element.insert',
  'design.export.used',
  'docs.page.create',
  'docs.page.edit',
  'git.commit.made',
  'git.branch.switch',
  'kanban.card.create',
  'kanban.card.move',
  'notes.note.create',
  'notes.note.edit',
  'calendar.event.create',
  'architect.diagram.create',
] as const

export type TelemetryFeatureKey = typeof TELEMETRY_FEATURE_KEYS[number]

const FEATURE_KEY_SET = new Set<string>(TELEMETRY_FEATURE_KEYS)

// ─── DB singleton ────────────────────────────────────────────────────────────

type Database = Awaited<ReturnType<typeof import('@tauri-apps/plugin-sql')['default']['load']>>

let _db: Database | null = null
let _dbPromise: Promise<Database> | null = null
let _dbFailed = false

async function getDb(): Promise<Database> {
  if (_dbFailed) throw new Error('SQL plugin unavailable')
  if (_db) return _db
  if (_dbPromise) return _dbPromise

  _dbPromise = (async () => {
    try {
      const Database = (await import('@tauri-apps/plugin-sql')).default
      const db = await Database.load(DB_NAME)
      await migrate(db)
      _db = db
      return db
    } catch (e) {
      _dbFailed = true
      _dbPromise = null
      import('@/composables/useLogger').then(({ getLogger }) => getLogger().then(l => l.warn('[Telemetry] SQL plugin unavailable — telemetry disabled for this session'))).catch(() => {})
      throw e
    }
  })()

  return _dbPromise
}

async function migrate(db: Database) {
  await db.execute(`
    CREATE TABLE IF NOT EXISTS telemetry_meta (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `)

  await db.execute(`
    CREATE TABLE IF NOT EXISTS sessions (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      started_at     TEXT NOT NULL,
      ended_at       TEXT,
      synced         INTEGER NOT NULL DEFAULT 0
    )
  `)

  await db.execute(`
    CREATE TABLE IF NOT EXISTS screen_views (
      screen_key TEXT PRIMARY KEY,
      count      INTEGER NOT NULL DEFAULT 0
    )
  `)

  await db.execute(`
    CREATE TABLE IF NOT EXISTS space_enters (
      space_id TEXT PRIMARY KEY,
      count    INTEGER NOT NULL DEFAULT 0
    )
  `)

  await db.execute(`
    CREATE TABLE IF NOT EXISTS space_active_ms (
      space_id  TEXT PRIMARY KEY,
      total_ms  INTEGER NOT NULL DEFAULT 0
    )
  `)

  await db.execute(`
    CREATE TABLE IF NOT EXISTS feature_actions (
      feature_key TEXT PRIMARY KEY,
      count       INTEGER NOT NULL DEFAULT 0
    )
  `)

  // Set schema version if not present
  await db.execute(`
    INSERT OR IGNORE INTO telemetry_meta (key, value) VALUES ('schema_version', '1')
  `)
  await db.execute(`
    INSERT OR IGNORE INTO telemetry_meta (key, value) VALUES ('first_recorded_at', ?)
  `, [new Date().toISOString()])
}

// ─── Consent ─────────────────────────────────────────────────────────────────

export function isTelemetryEnabled(): boolean {
  const v = localStorage.getItem(CONSENT_KEY)
  return v !== 'false' // absent or 'true' = enabled
}

export function setTelemetryConsent(enabled: boolean) {
  localStorage.setItem(CONSENT_KEY, enabled ? 'true' : 'false')
  import('@/composables/useTauriStore').then(({ getTauriStore }) =>
    getTauriStore().then(s => s?.set(CONSENT_KEY, enabled ? 'true' : 'false'))
  ).catch(() => {})
}

// ─── Background API sync ─────────────────────────────────────────────────────

function getAuthToken(): string | null {
  try {
    const authState = localStorage.getItem('cp_auth')
    if (authState) {
      const parsed = JSON.parse(authState)
      if (parsed.token) return parsed.token
    }
  } catch { /* ignore */ }
  // Fallback to legacy key
  return localStorage.getItem('cp_auth_token')
}

/** Check if the user appears to be authenticated (auth state exists) */
function isAuthenticated(): boolean {
  const authState = localStorage.getItem('cp_auth')
  if (!authState) return false
  try {
    const parsed = JSON.parse(authState)
    return !!(parsed.token || parsed.accessToken)
  } catch {
    return false
  }
}

async function syncToApi(): Promise<void> {
  if (!isTelemetryEnabled()) return
  if (!isAuthenticated()) return
  if (_dbFailed) return
  // Skip in dev mode — local API cannot validate OAuth tokens
  if (import.meta.env.DEV) return

  try {
    const token = getAuthToken()
    if (!token || token === 'dev_token_local') return

    const data = await getStoredData()
    if (!data || (data.sessions.total === 0 && Object.keys(data.screenViews).length === 0)) return

    // Enrich with OS info
    try {
      const { arch, platform, version, type: osType } = await import('@tauri-apps/plugin-os')
      data.osInfo = { arch: arch(), platform: platform(), version: version(), type: osType() }
    } catch {
      // OS plugin not available
    }

    const response = await fetch(`${appConfig.apiBase}/me/telemetry/sync`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': appConfig.apiKey,
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify(data),
      keepalive: true, // survives page unload
    })

    if (response.ok) {
      const db = await getDb()
      await db.execute(`UPDATE sessions SET synced = 1 WHERE synced = 0`)
    }
    // 401/403 are expected when token is expired — don't log
  } catch {
    // Silent failure — telemetry sync should never disrupt the user
  }
}

// ─── Periodic background sync ───────────────────────────────────────────────

const SYNC_INTERVAL_MS = 5 * 60 * 1000 // 5 minutes
let _syncTimer: ReturnType<typeof setInterval> | null = null

function startPeriodicSync(): void {
  if (_syncTimer) return
  // Initial sync after 30s (gives auth time to settle)
  setTimeout(() => syncToApi(), 30_000)
  // Then every 5 minutes
  _syncTimer = setInterval(() => syncToApi(), SYNC_INTERVAL_MS)
}

function stopPeriodicSync(): void {
  if (_syncTimer) {
    clearInterval(_syncTimer)
    _syncTimer = null
  }
}

// ─── Data access ─────────────────────────────────────────────────────────────

interface TelemetrySnapshot {
  schemaVersion: number
  firstRecordedAt: string
  lastUpdatedAt: string
  sessions: { total: number; lastStartedAt: string | null; lastEndedAt: string | null }
  screenViews: Record<string, number>
  spaceEnterCount: Record<string, number>
  spaceActiveMs: Record<string, number>
  featureActions: Record<string, number>
  osInfo?: { arch: string; platform: string; version: string; type: string }
}

async function getStoredData(): Promise<TelemetrySnapshot | null> {
  try {
    const db = await getDb()

    const meta = await db.select<{ key: string; value: string }[]>(
      'SELECT key, value FROM telemetry_meta'
    )
    const metaMap = Object.fromEntries(meta.map(r => [r.key, r.value]))

    const sessionRows = await db.select<{ total: number }[]>(
      'SELECT COUNT(*) as total FROM sessions'
    )
    const lastSession = await db.select<{ started_at: string; ended_at: string | null }[]>(
      'SELECT started_at, ended_at FROM sessions ORDER BY id DESC LIMIT 1'
    )

    const screenRows = await db.select<{ screen_key: string; count: number }[]>(
      'SELECT screen_key, count FROM screen_views'
    )

    const spaceEnterRows = await db.select<{ space_id: string; count: number }[]>(
      'SELECT space_id, count FROM space_enters'
    )

    const spaceActiveRows = await db.select<{ space_id: string; total_ms: number }[]>(
      'SELECT space_id, total_ms FROM space_active_ms'
    )

    const featureRows = await db.select<{ feature_key: string; count: number }[]>(
      'SELECT feature_key, count FROM feature_actions'
    )

    return {
      schemaVersion: parseInt(metaMap.schema_version ?? '1'),
      firstRecordedAt: metaMap.first_recorded_at ?? new Date().toISOString(),
      lastUpdatedAt: new Date().toISOString(),
      sessions: {
        total: sessionRows[0]?.total ?? 0,
        lastStartedAt: lastSession[0]?.started_at ?? null,
        lastEndedAt: lastSession[0]?.ended_at ?? null,
      },
      screenViews: Object.fromEntries(screenRows.map(r => [r.screen_key, r.count])),
      spaceEnterCount: Object.fromEntries(spaceEnterRows.map(r => [r.space_id, r.count])),
      spaceActiveMs: Object.fromEntries(spaceActiveRows.map(r => [r.space_id, r.total_ms])),
      featureActions: Object.fromEntries(featureRows.map(r => [r.feature_key, r.count])),
    }
  } catch (e) {
    import('@/composables/useLogger').then(({ getLogger }) => getLogger().then(l => l.error(`[Telemetry] Failed to read stored data: ${e}`))).catch(() => {})
    return null
  }
}

async function clearStoredData(): Promise<void> {
  try {
    const db = await getDb()
    await db.execute('DELETE FROM sessions')
    await db.execute('DELETE FROM screen_views')
    await db.execute('DELETE FROM space_enters')
    await db.execute('DELETE FROM space_active_ms')
    await db.execute('DELETE FROM feature_actions')
    await db.execute(`UPDATE telemetry_meta SET value = ? WHERE key = 'first_recorded_at'`, [new Date().toISOString()])
  } catch (e) {
    import('@/composables/useLogger').then(({ getLogger }) => getLogger().then(l => l.error(`[Telemetry] Failed to clear data: ${e}`))).catch(() => {})
  }
}

// ─── Tracking functions ──────────────────────────────────────────────────────

let _currentSessionId: number | null = null

async function trackSessionStart(): Promise<void> {
  if (!isTelemetryEnabled() || _dbFailed) return
  try {
    const db = await getDb()
    const result = await db.execute(
      'INSERT INTO sessions (started_at) VALUES (?)',
      [new Date().toISOString()]
    )
    _currentSessionId = result.lastInsertId ?? null
    startPeriodicSync()
  } catch {
    // DB init failed — already logged by getDb()
  }
}

async function trackSessionEnd(): Promise<void> {
  if (!isTelemetryEnabled() || _dbFailed) return
  stopPeriodicSync()
  // During page unload / visibilitychange the Tauri IPC bridge is already
  // torn down, so any SQL execute will throw a fetch error in console.
  // Skip the DB write entirely — the session duration is non-critical.
  // Just fire the API sync (uses fetch keepalive to survive unload).
  syncToApi()
}

async function trackScreenView(routeName: string, spaceId?: string): Promise<void> {
  if (!isTelemetryEnabled() || _dbFailed) return
  try {
    const key = spaceId ? `space:${spaceId}` : routeName
    const db = await getDb()
    await db.execute(`
      INSERT INTO screen_views (screen_key, count) VALUES (?, 1)
      ON CONFLICT(screen_key) DO UPDATE SET count = count + 1
    `, [key])
  } catch {
    // Silent
  }
}

async function trackSpaceEnter(spaceId: string): Promise<void> {
  if (!isTelemetryEnabled() || _dbFailed) return
  try {
    const db = await getDb()
    await db.execute(`
      INSERT INTO space_enters (space_id, count) VALUES (?, 1)
      ON CONFLICT(space_id) DO UPDATE SET count = count + 1
    `, [spaceId])
  } catch {
    // Silent
  }
}

async function trackSpaceLeave(spaceId: string, activeMs: number): Promise<void> {
  if (!isTelemetryEnabled() || _dbFailed) return
  try {
    const ms = Math.round(activeMs)
    if (ms <= 0) return
    const db = await getDb()
    await db.execute(`
      INSERT INTO space_active_ms (space_id, total_ms) VALUES (?, ?)
      ON CONFLICT(space_id) DO UPDATE SET total_ms = total_ms + ?
    `, [spaceId, ms, ms])
  } catch {
    // Silent
  }
}

export async function trackFeature(key: string): Promise<void> {
  if (!isTelemetryEnabled() || _dbFailed) return

  if (!FEATURE_KEY_SET.has(key)) {
    if (import.meta.env.DEV) {
      console.warn(`[Telemetry] Unknown feature key rejected: "${key}"`)
    }
    return
  }

  try {
    const db = await getDb()
    await db.execute(`
      INSERT INTO feature_actions (feature_key, count) VALUES (?, 1)
      ON CONFLICT(feature_key) DO UPDATE SET count = count + 1
    `, [key])
  } catch {
    // Silent
  }
}

// ─── Composable ──────────────────────────────────────────────────────────────

export function useTelemetry() {
  return {
    get isEnabled() { return isTelemetryEnabled() },
    trackSessionStart,
    trackSessionEnd,
    trackScreenView,
    trackSpaceEnter,
    trackSpaceLeave,
    trackFeature,
    getStoredData,
    clearStoredData,
    syncToApi,
  }
}
