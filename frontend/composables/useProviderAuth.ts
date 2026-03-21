/**
 * useProviderAuth - LLM provider authentication
 * Reads tokens from Claude Code keychain or Codex CLI and forwards to operator.
 */
import { ref, readonly } from 'vue'
import { invoke } from '@tauri-apps/api/core'

export function useProviderAuth() {
  const isAuthenticated = ref(false)
  const isLoading = ref(false)
  const error = ref<string | null>(null)
  const expiresAt = ref<number | null>(null)
  const isTauri = typeof window !== 'undefined' && '__TAURI__' in window

  /**
   * Check authentication status from operator
   */
  const checkStatus = async () => {
    if (!isTauri) return

    try {
      const result = await invoke<{ authenticated?: boolean, expires_at?: number }>('send_context_request', {
        requestType: 'auth.anthropic.status',
        payload: {},
      })
      if (result && typeof result.authenticated === 'boolean') {
        isAuthenticated.value = result.authenticated
        expiresAt.value = result.expires_at || null
      }
    } catch {
      // Operator not connected yet
    }
  }

  async function ensureOperator() {
    try {
      await invoke<string>('start_context_service')
    } catch {
      try {
        const isDev = await invoke<boolean>('get_is_dev_instance')
        const address = isDev ? '127.0.0.1:60200' : '127.0.0.1:60100'
        await invoke('connect_context', { address })
      } catch {
        throw new Error('Operator not available')
      }
    }
  }

  /**
   * Login using Claude Code's keychain tokens
   */
  const loginFromKeychain = async (): Promise<boolean> => {
    if (!isTauri) return false
    error.value = null
    isLoading.value = true

    try {
      const result = await invoke<{ access_token: string, refresh_token?: string, expires_in?: number }>('oauth_read_keychain')
      await ensureOperator()
      await invoke('send_context_request', {
        requestType: 'auth.anthropic.set_tokens',
        payload: {
          access_token: result.access_token,
          refresh_token: result.refresh_token || '',
          expires_in: result.expires_in || 3600,
        },
      })

      isAuthenticated.value = true
      return true
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to read keychain'
      return false
    } finally {
      isLoading.value = false
    }
  }

  /**
   * Login using Codex CLI tokens (~/.codex/auth.json)
   */
  const loginFromCodex = async (): Promise<boolean> => {
    if (!isTauri) return false
    error.value = null
    isLoading.value = true

    try {
      const result = await invoke<{ access_token: string, refresh_token?: string, account_id?: string }>('codex_read_tokens')
      await ensureOperator()
      await invoke('send_context_request', {
        requestType: 'auth.openai.set_tokens',
        payload: {
          access_token: result.access_token,
          refresh_token: result.refresh_token || '',
          account_id: result.account_id || '',
        },
      })

      return true
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to read Codex tokens'
      return false
    } finally {
      isLoading.value = false
    }
  }

  /**
   * Logout - clear tokens via operator
   */
  const logout = async () => {
    if (!isTauri) return

    try {
      await invoke('send_context_request', {
        requestType: 'auth.anthropic.clear',
        payload: {},
      })
    } catch {
      // ignore
    }

    isAuthenticated.value = false
    expiresAt.value = null
    error.value = null
  }

  if (isTauri) {
    checkStatus()
  }

  return {
    isAuthenticated,
    isLoading: readonly(isLoading),
    error: readonly(error),
    expiresAt: readonly(expiresAt),
    loginFromKeychain,
    loginFromCodex,
    checkStatus,
    logout,
  }
}
