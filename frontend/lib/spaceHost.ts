/**
 * Space Host Module Provider
 *
 * Exposes shared host dependencies as window.__CONSTRUCT__ globals.
 * Space IIFE bundles reference these via rollup externals:
 *   import { ref } from 'vue'  →  window.__CONSTRUCT__['vue'].ref
 *
 * Called once in main.ts before app mount.
 */

// Re-export pure constants from the side-effect-free constants module.
// Import from spaceHostConstants.ts when you only need the data (e.g. tests, validation).
// Import from this file (spaceHost.ts) when you also need initSpaceHost().
export {
  HOST_API_VERSION,
  HOST_PROVIDED_PACKAGES,
  type HostExternalizationId,
} from './spaceHostConstants'

import * as Vue from 'vue'
import * as VueRouter from 'vue-router'
import * as Pinia from 'pinia'
import * as VueUseCore from '@vueuse/core'
import * as VueUseIntegrations from '@vueuse/integrations'
import * as Lucide from 'lucide-vue-next'
import * as DateFns from 'date-fns'
import DexieDefault, * as DexieNs from 'dexie'
import * as Zod from 'zod'
import * as ConstructUI from '@/lib/constructUiRuntime.js'
import * as ConstructSdk from '@/lib/constructSdk'
import { useProjectStore } from '@/stores/project'
import { appConfig } from '@/utils/config'

declare global {
  interface Window {
    __CONSTRUCT__: Record<string, unknown>
    construct: ConstructRuntime
    [key: `__CONSTRUCT_SPACE_${string}`]: {
      pages: Record<string, unknown>
      components?: Record<string, unknown>
    } | undefined
  }
}

/** Runtime context exposed to SDK data/media composables as `window.construct` */
interface AuthStoreLike {
  user?: { id?: string | null } | null
  oauthToken?: string | null
  token?: string | null
}

interface ProjectStoreLike {
  currentProject?: { id?: string | number | null } | null
}

interface ConstructRuntime {
  config: { graphUrl: string; apiBase: string }
  auth: { getAccessToken(): Promise<string | null>; getUserId(): string | null }
  space: { id: string }
  project: { id: string }
  /** 'app' for personal mode, 'org' when the user is operating inside an organization. */
  scope: 'app' | 'org'
  operator: { send(type: string, payload?: Record<string, unknown>): Promise<unknown> }
  storage: { get(key: string): Promise<string | null>; set(key: string, value: string): Promise<void>; remove(key: string): Promise<void> }
  /**
   * Open a URL in the system browser. Spaces can't reach the Tauri opener
   * plugin directly (the bundle validator blocks `__TAURI_INTERNALS__`).
   * This bridge proxies to plugin-opener inside the host.
   */
  shell: { openUrl(url: string): Promise<void> }
  /**
   * Host-mediated GraphQL bridge. Bearer token is attached server-side by
   * the host (using the user's session) — spaces never see it. Throws
   * UnauthenticatedError on 401 so spaces can render a sign-in state.
   */
  graph: {
    query<T = unknown>(
      query: string,
      variables?: Record<string, unknown>,
      options?: { spaceId?: string; projectId?: string },
    ): Promise<T>
  }
}

export class UnauthenticatedError extends Error {
  override name = 'UnauthenticatedError'
}

const SPACE_OPERATOR_PREFIXES = ['media.', 'storage.'] as const

/**
 * Initialize the host module provider.
 * Must be called before any space bundles are loaded.
 */
export function initSpaceHost(): void {
  const exposed: Record<string, unknown> = {
    'vue': Vue,
    'vue-router': VueRouter,
    'pinia': Pinia,
    '@vueuse/core': VueUseCore,
    '@vueuse/integrations': VueUseIntegrations,
    'lucide-vue-next': Lucide,
    'date-fns': DateFns,
    'dexie': Object.assign(DexieDefault, DexieNs),
    'zod': Zod,
    '@construct-space/ui': ConstructUI,
    '@construct-space/sdk': ConstructSdk,
    // The `@construct/sdk` alias was removed in SDK 2.0 — pre-rename
    // space bundles that still externalise it will get a clear error
    // from the __CONSTRUCT__ Proxy guard pointing here.
  }

  // Guard against silent drift between the CLI scaffold's externals list
  // (packages/construct-cli/templates/space/vite.config.ts.tmpl) and what
  // this host actually exposes. Without this, a space that externalises a
  // package the host forgot to register gets `undefined` and crashes
  // later with "X is not a function" — wasting time on the consumer side.
  // The Proxy throws a clear, actionable error the first time the
  // missing key is touched.
  window.__CONSTRUCT__ = new Proxy(exposed, {
    get(target, key) {
      if (typeof key === 'symbol') return Reflect.get(target, key)
      if (key in target) return target[key]
      throw new Error(
        `Space externalised "${key}" but the host doesn't expose it. ` +
        `Either bundle it in the space's vite.config.ts (remove from hostExternals), ` +
        `or add it to construct-app/frontend/lib/spaceHost.ts initSpaceHost().`,
      )
    },
    has(target, key) {
      return key in target
    },
    ownKeys(target) {
      return Reflect.ownKeys(target)
    },
    getOwnPropertyDescriptor(target, key) {
      return Reflect.getOwnPropertyDescriptor(target, key)
    },
  })

  // Inject window.construct runtime for space composables
  window.construct = {
    config: {
      graphUrl: appConfig.graphUrl,
      apiBase: appConfig.apiBase,
    },
    auth: {
      async getAccessToken() {
        // TODO: gate behind first-party/trusted-space flag once host-mediated
        // graph proxy is the only data path. Today returning null breaks every
        // space using @construct-space/graph (401 from backend).
        try {
          const store = ConstructSdk.useAuthStore() as AuthStoreLike
          return store.oauthToken ?? store.token ?? null
        } catch { return null }
      },
      getUserId() {
        try {
          const store = ConstructSdk.useAuthStore() as AuthStoreLike
          return store.user?.id || null
        } catch { return null }
      },
    },
    space: { id: '' }, // Updated per-space at load time
    project: {
      get id() {
        try {
          const store = useProjectStore() as ProjectStoreLike | undefined
          return store?.currentProject?.id?.toString() || 'default'
        } catch { return 'default' }
      },
    },
    get scope(): 'app' | 'org' {
      try {
        return ConstructSdk.useOrg().isOrg.value ? 'org' : 'app'
      } catch { return 'app' }
    },
    operator: {
      async send(type: string, payload?: Record<string, unknown>) {
        if (!SPACE_OPERATOR_PREFIXES.some(prefix => type.startsWith(prefix))) {
          throw new Error(`Operator method not available to spaces: ${type}`)
        }
        const { useBrain } = await import('@/brain')
        const brain = useBrain()
        return brain.request(type, payload)
      },
    },
    storage: {
      async get(key: string) {
        const { useLocalStorage } = await import('@/composables/useLocalStorage')
        const storage = useLocalStorage()
        return storage.get(key)
      },
      async set(key: string, value: string) {
        const { useLocalStorage } = await import('@/composables/useLocalStorage')
        const storage = useLocalStorage()
        return storage.set(key, value)
      },
      async remove(key: string) {
        const { useLocalStorage } = await import('@/composables/useLocalStorage')
        const storage = useLocalStorage()
        return storage.remove(key)
      },
    },
    shell: {
      async openUrl(url: string): Promise<void> {
        // plugin-opener is permissive about URL shape and works for
        // multi-dot hosts (accounts.google.com etc) that plugin-shell
        // rejects. Same pattern useConstructAuth uses internally.
        try {
          const { openUrl } = await import('@tauri-apps/plugin-opener')
          await openUrl(url)
        } catch {
          if (typeof window !== 'undefined') window.open(url, '_blank', 'noopener,noreferrer')
        }
      },
    },
    graph: {
      async query<T = unknown>(
        query: string,
        variables: Record<string, unknown> = {},
        options?: { spaceId?: string; projectId?: string },
      ): Promise<T> {
        let token: string | null = null
        try {
          const store = ConstructSdk.useAuthStore() as AuthStoreLike
          token = store.oauthToken ?? store.token ?? null
        } catch { /* no store available */ }

        // Allow callers (e.g. home-screen widgets reading another space's
        // data via `useGraph(model, { spaceId })`) to override the active
        // space/project for this request only.
        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
          'X-Space-ID': options?.spaceId || window.construct.space?.id || 'default',
          'X-Project-ID': options?.projectId || window.construct.project?.id || 'default',
        }
        if (token) headers['Authorization'] = `Bearer ${token}`

        // Hard timeout so a stalled request (flaky network, esp. on Windows)
        // can't leave a space's useGraph list stuck in `loading` forever —
        // which froze the calendar after saving an event. Abort + reject so
        // the caller's catch/finally runs and the UI recovers.
        const controller = new AbortController()
        const TIMEOUT_MS = 20000
        const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
        let resp: Response
        try {
          resp = await fetch(`${appConfig.graphUrl}/graphql`, {
            method: 'POST',
            headers,
            body: JSON.stringify({ query, variables }),
            signal: controller.signal,
          })
        } catch (e) {
          if ((e as Error)?.name === 'AbortError') {
            throw new Error(`Graph request timed out after ${TIMEOUT_MS / 1000}s`, { cause: e })
          }
          throw e
        } finally {
          clearTimeout(timer)
        }

        if (resp.status === 401) {
          throw new UnauthenticatedError('graph: not authenticated')
        }
        if (!resp.ok) {
          const text = await resp.text().catch(() => '')
          throw new Error(`Graph request failed (${resp.status}): ${text.slice(0, 200)}`)
        }
        const json = await resp.json() as { data?: T; errors?: Array<{ message: string }> }
        if (json.errors?.length) {
          throw new Error(`Graph errors: ${json.errors.map(e => e.message).join('; ')}`)
        }
        return json.data as T
      },
    },
  }
}
