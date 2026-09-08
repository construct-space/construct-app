/**
 * Shared OAuth helpers for provider cards that need Monthly-plan sign-in.
 * Thin wrapper around brain's `oauth.*` wire routes:
 *
 *   oauth.login         — start a browser OAuth flow. Brain kicks off
 *                         a goroutine and returns {pending:true}
 *                         immediately.
 *   oauth.poll          — poll a pending browser flow. Returns
 *                         {status:"pending"}, {success:true}, or {error}.
 *   oauth.providers     — list connected OAuth providers with
 *                         {id, name, connected, email?, ...}.
 *   oauth.logout        — disconnect a provider.
 *   oauth.cancel        — abort an in-flight OAuth flow.
 *
 * Note: oauth flow ids ≠ connector ids. The login router wants flow ids
 * ("claude", "openai-codex", "google-gemini-cli"), not connector ids
 * ("claude-oauth" — those are only used after login, to route model calls).
 */

import { ref } from 'vue'
import { useBrain } from '@/brain'
import { configuredVersion } from '@/composables/useProviderCard'

export interface OAuthProviderState {
  connected: boolean
  email?: string
  name?: string
}

interface OAuthLoginResponse {
  pending?: boolean
  success?: boolean
}

interface OAuthPollResponse {
  pending?: boolean
  success?: boolean
  error?: string
  status?: string
}

interface OAuthProviderEntry extends OAuthProviderState {
  id?: string
  flow?: string
}

interface OAuthProvidersResponse {
  providers?: OAuthProviderEntry[]
}

export function useProviderOAuth() {
  const brain = useBrain()

  const loading = ref<Record<string, boolean>>({})
  // Set when the user cancels an in-flight flow so pollPending can exit
  // cleanly instead of surfacing the brain's "no pending flow" as an error.
  const cancelled = ref<Record<string, boolean>>({})

  /** Start the provider's OAuth flow. Non-blocking: brain kicks off a
   *  goroutine and returns {pending:true} immediately. */
  async function start(providerId: string): Promise<{ pending?: boolean; success?: boolean } | null> {
    loading.value[providerId] = true
    try {
      const res = (await brain.request('oauth.login', { provider: providerId })) as OAuthLoginResponse
      // Immediate (non-browser) success — signal a config change so the
      // providers panel reloads the global useAIModel catalog.
      if (res?.success) configuredVersion.value++
      return res
    } catch (err) {
      loading.value[providerId] = false
      throw err
    }
  }

  /** Poll a pending browser flow. Resolves true on success, throws on
   *  explicit error, times out after ~5 minutes. Keeps `loading` on for
   *  the whole wait so the caller doesn't need to juggle the flag. */
  async function pollPending(providerId: string): Promise<boolean> {
    const deadline = Date.now() + 5 * 60 * 1000
    loading.value[providerId] = true
    cancelled.value[providerId] = false
    try {
      while (Date.now() < deadline) {
        if (cancelled.value[providerId]) return false
        const res = (await brain.request('oauth.poll', { provider: providerId }).catch(() => null)) as OAuthPollResponse | null
        // Re-check after the await: a cancel may have landed mid-poll. Drop
        // the result (incl. the brain's "no pending flow" error) silently.
        if (cancelled.value[providerId]) return false
        if (res?.success) { configuredVersion.value++; return true }
        if (res?.error) throw new Error(res.error)
        // status:"pending" or null → keep polling
        await new Promise((r) => setTimeout(r, 2000))
      }
      throw new Error('OAuth flow timed out')
    } finally {
      loading.value[providerId] = false
      cancelled.value[providerId] = false
    }
  }

  /** Cancel an in-flight flow. Marks it cancelled so a concurrent
   *  pollPending exits without throwing, then tells the brain to abort. */
  async function cancel(providerId: string): Promise<void> {
    cancelled.value[providerId] = true
    loading.value[providerId] = false
    await brain.request('oauth.cancel', { provider: providerId }).catch(() => { /* best effort */ })
  }

  /** Disconnect a provider's stored creds. */
  async function disconnect(providerId: string): Promise<void> {
    await brain.request('oauth.logout', { provider: providerId }).catch(() => { /* best effort */ })
    // Provider creds cleared — signal a config change so the panel reloads
    // the global catalog (drops the provider's models; normalizes the
    // default model if it belonged to this provider).
    configuredVersion.value++
  }

  /** Fetch connection state for one provider. Uses oauth.providers and
   *  filters by id — avoids adding a dedicated per-provider status RPC. */
  async function getStatus(providerId: string): Promise<OAuthProviderState> {
    try {
      const res = (await brain.request('oauth.providers', {}).catch(() => null)) as OAuthProvidersResponse | null
      const entries = res?.providers || []
      const me = entries.find((p) => p.id === providerId || p.flow === providerId)
      if (!me) return { connected: false }
      return {
        connected: !!me.connected,
        email: me.email,
        name: me.name,
      }
    } catch {
      return { connected: false }
    }
  }

  return {
    loading,
    start,
    pollPending,
    cancel,
    disconnect,
    getStatus,
  }
}
