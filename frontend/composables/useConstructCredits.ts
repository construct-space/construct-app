/**
 * Construct gateway credits (provider-api).
 *
 * Distinct from useCredits (Polar-style purchase pool). This composable
 * tracks the per-user free-tier counter the Construct gateway debits
 * for every chat call that goes through Source family routing.
 *
 * Sources of truth:
 *   - GET /api/construct/usage         → initial + on-demand refresh
 *   - "routing" wire event from brain  → live updates after each chat
 *     turn (cheap; no extra fetch)
 *
 * Singleton-style: state at module scope so the indicator in the
 * assistant panel header and a refresh on the LLM Providers card share
 * the same data.
 */
import { ref } from 'vue'
import { useAuthStore } from '@/stores/auth'

export interface ConstructCreditsSnapshot {
  used: number
  allowance: number
  paidBalance: number
  resetAt: string
  blocked: boolean
  enabled: boolean
}

const used = ref(0)
const allowance = ref(0)
const paidBalance = ref(0)
const resetAt = ref<string>('')
const blocked = ref(false)
const enabled = ref(true)
const loaded = ref(false)
const error = ref<string | null>(null)

async function fetchConstructCredits(): Promise<ConstructCreditsSnapshot | null> {
  try {
    // Desktop auth is a Bearer token (cat_*), not a cookie — the gateway's
    // session validator accepts either, but the Tauri app never sends
    // cookies. Read the token from the auth store and attach explicitly.
    const auth = useAuthStore()
    const token = auth.oauthToken || auth.token
    if (!token) return null
    const res = await fetch('https://my.construct.space/api/construct/usage', {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!res.ok) {
      // Unauthenticated reads return 401; treat as "no data" rather than error.
      if (res.status === 401) return null
      error.value = `usage ${res.status}`
      return null
    }
    const data = await res.json() as {
      daily_used?: number
      daily_allowance?: number
      paid_balance?: number
      reset_at?: string
      blocked?: boolean
      construct_enabled?: boolean
    }
    used.value = data.daily_used ?? 0
    allowance.value = data.daily_allowance ?? 0
    paidBalance.value = data.paid_balance ?? 0
    resetAt.value = data.reset_at ?? ''
    blocked.value = data.blocked ?? false
    enabled.value = data.construct_enabled ?? true
    loaded.value = true
    error.value = null
    return {
      used: used.value,
      allowance: allowance.value,
      paidBalance: paidBalance.value,
      resetAt: resetAt.value,
      blocked: blocked.value,
      enabled: enabled.value,
    }
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
    return null
  }
}

/** Brain emits a "routing" wire chunk that includes the credit counters
 *  from the gateway's response headers. Apply them here so the indicator
 *  updates as the user chats — no extra fetch. */
function applyRoutingCredits(snap: { used?: number; allowance?: number; balance?: number }) {
  if (typeof snap.used === 'number') used.value = snap.used
  if (typeof snap.allowance === 'number' && snap.allowance > 0) allowance.value = snap.allowance
  if (typeof snap.balance === 'number') paidBalance.value = snap.balance
  loaded.value = true
}

export function useConstructCredits() {
  return {
    used,
    allowance,
    paidBalance,
    resetAt,
    blocked,
    enabled,
    loaded,
    error,
    fetchConstructCredits,
    applyRoutingCredits,
  }
}
