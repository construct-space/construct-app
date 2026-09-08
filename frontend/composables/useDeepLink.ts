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
        return
      }


      // Close the OAuth login window
      closeOAuthWindow()

      if (error) {
        router.push(`/oauth/callback?error=${encodeURIComponent(error)}`)
      } else if (code && state) {
        router.push(`/oauth/callback?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`)
      } else {
        console.warn('[DeepLink] OAuth callback missing code or state')
      }
      return
    }

    const type = segments[0]
    const id = segments[1]

    // Org invite: construct://org/invite/{token}
    if (action === 'org' && type === 'invite' && id) {
      router.push(`/app/org?invite=${encodeURIComponent(id)}`)
      return
    }

    if (action === 'install' && type === 'spaces' && id) {
      marketplace.install(id)
      // Honour any sub-path after the space id, e.g.
      // construct://install/spaces/meet/room/<uuid>
      const sub = segments.slice(2).join('/')
      router.push(sub ? `/app/${id}/${sub}` : `/app/${id}`)
    } else if (action === 'open' && type === 'spaces' && id) {
      // Legacy form, kept for back-compat:
      //   construct://open/spaces/<spaceId>[/<sub-path...>]
      // New code should prefer the `app/` form below which mirrors the
      // in-app router path.
      const sub = segments.slice(2).join('/')
      router.push(sub ? `/app/${id}/${sub}` : `/app/${id}`)
    } else if (action === 'app' && type) {
      // construct://app/<spaceId>[/<sub-path...>] — mirrors the in-app
      // route `/app/<spaceId>/<sub-path>`. Spaces hand these out as
      // invite / share links (meet rooms, board cards, etc.) and the
      // OS hands them to the desktop client.
      const spaceId = type
      const sub = segments.slice(1).join('/')
      router.push(sub ? `/app/${spaceId}/${sub}` : `/app/${spaceId}`)
    } else if (action === 'marketplace') {
      router.push('/app/marketplace')
    }
  }

  // Check if app was launched via deep link
  getCurrent().then(urls => {
    if (urls?.length) void handleUrl(urls[0])
  }).catch(err => console.error('[DeepLink] getCurrent error:', err))

  // Listen for deep links while app is running
  onOpenUrl(urls => {
    if (urls.length) void handleUrl(urls[0])
  })
}
