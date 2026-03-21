/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_CONSTRUCT_DEV_MODE?: string
  readonly VITE_SPACE_DEV_DIR?: string
}

// Extend ImportMeta for Nuxt compat
interface ImportMeta {
  readonly env: ImportMetaEnv
  readonly client: boolean
  readonly server: boolean
}

// Nuxt compat stubs
// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare function defineShortcuts(shortcuts: any): void
// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare function extractShortcuts(items: any): any
declare function useState<T>(key: string, init?: () => T): import('vue').Ref<T>
declare function generateLocalId(): string
declare const __APP_VERSION__: string
