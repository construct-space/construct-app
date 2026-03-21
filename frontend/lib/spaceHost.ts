/**
 * Space Host Module Provider
 *
 * Exposes shared host dependencies as window.__CONSTRUCT__ globals.
 * Space IIFE bundles reference these via rollup externals:
 *   import { ref } from 'vue'  →  window.__CONSTRUCT__['vue'].ref
 *
 * Called once in main.ts before app mount.
 */

import * as Vue from 'vue'
import * as VueRouter from 'vue-router'
import * as Pinia from 'pinia'
import * as VueUseCore from '@vueuse/core'
import * as VueUseIntegrations from '@vueuse/integrations'
import * as TauriApi from '@tauri-apps/api'
import * as TauriApiCore from '@tauri-apps/api/core'
import * as TauriApiPath from '@tauri-apps/api/path'
import * as TauriApiEvent from '@tauri-apps/api/event'
import * as TauriApiWebview from '@tauri-apps/api/webview'
import * as TauriFs from '@tauri-apps/plugin-fs'
import * as TauriShell from '@tauri-apps/plugin-shell'
import * as TauriDialog from '@tauri-apps/plugin-dialog'
import * as TauriProcess from '@tauri-apps/plugin-process'
import * as RekaUi from 'reka-ui'
import * as Lucide from 'lucide-vue-next'
import * as DateFns from 'date-fns'
import DexieDefault, * as DexieNs from 'dexie'
import * as Zod from 'zod'
import * as ConstructSdk from '@/lib/constructSdk'
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
interface ConstructRuntime {
  config: { paasUrl: string; apiBase: string }
  auth: { getAccessToken(): Promise<string | null>; getUserId(): string | null }
  space: { id: string }
  project: { id: string }
  operator: { send(type: string, payload: any): Promise<any> }
  storage: { get(key: string): Promise<string | null>; set(key: string, value: string): Promise<void>; remove(key: string): Promise<void> }
}

/**
 * Initialize the host module provider.
 * Must be called before any space bundles are loaded.
 */
export function initSpaceHost(): void {
  window.__CONSTRUCT__ = {
    'vue': Vue,
    'vue-router': VueRouter,
    'pinia': Pinia,
    '@vueuse/core': VueUseCore,
    '@vueuse/integrations': VueUseIntegrations,
    '@tauri-apps/api': TauriApi,
    '@tauri-apps/api/core': TauriApiCore,
    '@tauri-apps/api/path': TauriApiPath,
    '@tauri-apps/api/event': TauriApiEvent,
    '@tauri-apps/api/webview': TauriApiWebview,
    '@tauri-apps/plugin-fs': TauriFs,
    '@tauri-apps/plugin-shell': TauriShell,
    '@tauri-apps/plugin-dialog': TauriDialog,
    '@tauri-apps/plugin-process': TauriProcess,
    'reka-ui': RekaUi,
    'lucide-vue-next': Lucide,
    'date-fns': DateFns,
    'dexie': Object.assign(DexieDefault, DexieNs),
    'zod': Zod,
    '@construct/sdk': ConstructSdk,
    // Backward compatibility for older space bundles that still externalize
    // the pre-rename SDK module id.
    '@construct-space/sdk': ConstructSdk,
  }

  // Inject window.construct runtime for SDK data/media composables
  // These access construct.config.paasUrl, construct.auth.getAccessToken(), etc.
  ;(window as any).construct = {
    config: {
      paasUrl: appConfig.paasUrl,
      apiBase: appConfig.apiBase,
    },
    auth: {
      async getAccessToken() {
        try {
          const { useAuthStore } = await import('@/stores/auth')
          return useAuthStore().token
        } catch { return null }
      },
      getUserId() {
        try {
          const store = ConstructSdk.useAuthStore()
          return (store as any).user?.id?.toString() || null
        } catch { return null }
      },
    },
    space: { id: '' }, // Updated per-space at load time
    project: {
      get id() {
        try {
          const store = (ConstructSdk as any).useProjectStore?.()
          return store?.currentProject?.id?.toString() || 'default'
        } catch { return 'default' }
      },
    },
    operator: {
      async send(type: string, payload: any) {
        const { useOperator } = await import('@/operator')
        const op = useOperator()
        return op.send(type, payload)
      },
    },
    storage: {
      async get(key: string) {
        const { useStorage } = await import('@/composables/useStorage')
        const storage = useStorage()
        return storage.get(key)
      },
      async set(key: string, value: string) {
        const { useStorage } = await import('@/composables/useStorage')
        const storage = useStorage()
        return storage.set(key, value)
      },
      async remove(key: string) {
        const { useStorage } = await import('@/composables/useStorage')
        const storage = useStorage()
        return storage.remove(key)
      },
    },
  }
}

/**
 * Get the host API version for compatibility checking.
 */
export const HOST_API_VERSION = '0.2.0'
