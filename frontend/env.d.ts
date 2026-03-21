/// <reference types="vite/client" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<object, object, unknown>
  export default component
}

interface ImportMetaEnv {
  readonly VITE_API_BASE: string
  readonly VITE_API_KEY: string
  readonly VITE_FREEPIK_API_KEY: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
