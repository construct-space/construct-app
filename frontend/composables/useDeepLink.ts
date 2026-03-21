import { onOpenUrl, getCurrent } from '@tauri-apps/plugin-deep-link'
import { useRouter } from 'vue-router'
import { APP_DEEP_LINK_SCHEME } from '@/lib/appPaths'
import { useSpaceMarketplace } from './useSpaceMarketplace'
import { useConstructAuth } from './useConstructAuth'
import { isTauriEnv } from '@/utils/tauri'
import { info } from '@tauri-apps/plugin-log'

export function useDeepLink() {
  if (!isTauriEnv()) return

  const router = useRouter()
  const marketplace = useSpaceMarketplace()
  const { closeOAuthWindow } = useConstructAuth()

  function readOAuthParams(parsed: URL): { code?: string; state?: string; error?: string } {
    let code = parsed.searchParams.get('code') || undefined
    let state = parsed.searchParams.get('state') || undefined
    let error = parsed.searchParams.get('error') || undefined
    if ((!code && !error) && parsed.hash) {
      const hashParams = new URLSearchParams(parsed.hash.startsWith('#') ? parsed.hash.slice(1) : parsed.hash)
      code = code || hashParams.get('code') || undefined
      state = state || hashParams.get('state') || undefined
      error = error || hashParams.get('error') || undefined
    }
    return { code, state, error }
  }

  async function handleUrl(url: string) {
    info(`[DeepLink] Received URL: ${url}`)
    const parsed = new URL(url)
    const segments = parsed.pathname.replace(/^\/+/, '').split('/')
    const action = parsed.host
    const protocol = parsed.protocol
    info(`[DeepLink] Parsed — protocol: ${protocol}, action: ${action}, segments: ${segments.join('/')}`)

    // OAuth callback: <scheme>://oauth/callback?code=xxx&state=xxx
    if (protocol === `${APP_DEEP_LINK_SCHEME}:` && action === 'oauth' && segments[0] === 'callback') {
      const { code, state, error } = readOAuthParams(parsed)

      // Skip if no params at all (stale getCurrent() on app launch)
      if (!code && !state && !error) {
        console.log('[DeepLink] OAuth callback with no params, ignoring')
        return
      }

      console.log('[DeepLink] OAuth callback — code:', code?.slice(0, 8) + '...', 'state:', state?.slice(0, 8) + '...', 'error:', error)

      // Close the OAuth login window
      closeOAuthWindow()

      if (error) {
        router.push(`/oauth/callback?error=${encodeURIComponent(error)}`)
      } else if (code && state) {
        console.log('[DeepLink] Pushing to /oauth/callback')
        router.push(`/oauth/callback?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`)
      } else {
        console.warn('[DeepLink] OAuth callback missing code or state')
      }
      return
    }

    const type = segments[0]
    const id = segments[1]

    if (action === 'install' && type === 'spaces' && id) {
      marketplace.install(id)
      router.push(`/app/${id}`)
    } else if (action === 'open' && type === 'spaces' && id) {
      router.push(`/app/${id}`)
    } else if (action === 'marketplace') {
      router.push('/app/marketplace')
    }
  }

  // Check if app was launched via deep link
  getCurrent().then(urls => {
    console.log('[DeepLink] getCurrent:', urls)
    if (urls?.length) void handleUrl(urls[0])
  }).catch(err => console.error('[DeepLink] getCurrent error:', err))

  // Listen for deep links while app is running
  onOpenUrl(urls => {
    console.log('[DeepLink] onOpenUrl:', urls)
    if (urls.length) void handleUrl(urls[0])
  })
}
