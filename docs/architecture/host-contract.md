# Host Contract

Two shared runtime layers connect the Construct host app to spaces (extensions).

## Layer 1: `window.__CONSTRUCT__` — Host-Provided Packages

Spaces are built as IIFE bundles with Rollup externals. When a space does
`import { ref } from 'vue'`, the bundler rewrites it to
`window.__CONSTRUCT__['vue'].ref`.

The host initializes this global once in `main.ts` via `initSpaceHost()`.

### Provided packages

| Key | Package |
|-----|---------|
| `vue` | Vue 3 reactivity, components, lifecycle |
| `vue-router` | Client-side routing |
| `pinia` | State management |
| `@vueuse/core` | Composition utilities |
| `@vueuse/integrations` | Third-party integrations |
| `@tauri-apps/api` | Tauri IPC core |
| `@tauri-apps/api/core` | Tauri invoke |
| `@tauri-apps/api/path` | Path utilities |
| `@tauri-apps/api/event` | Event system |
| `@tauri-apps/api/webview` | Webview management |
| `@tauri-apps/plugin-fs` | File system access |
| `@tauri-apps/plugin-shell` | Shell commands |
| `@tauri-apps/plugin-dialog` | Native dialogs |
| `@tauri-apps/plugin-process` | Process control |
| `lucide-vue-next` | Icon library |
| `date-fns` | Date utilities |
| `dexie` | IndexedDB wrapper |
| `zod` | Schema validation |
| `@construct-space/ui` | Construct component library |
| `@construct/sdk` | Construct SDK (stores, composables) |
| `@construct-space/sdk` | Legacy alias for `@construct/sdk` |

Source: `frontend/lib/spaceHost.ts`

## Layer 2: `window.construct` — Runtime API

Provides config, auth, project, operator, and storage access to space composables.
Does not require IIFE externals; any code can read `window.construct`.

### Shape

```typescript
interface ConstructRuntime {
  config: {
    graphUrl: string
    apiBase: string
  }
  auth: {
    getAccessToken(): Promise<string | null>
    getUserId(): string | null
  }
  space: { id: string }       // Updated per-space at load time
  project: { id: string }     // Reactive getter from project store
  operator: {
    send(type: string, payload?: Record<string, unknown>): Promise<unknown>
  }
  storage: {
    get(key: string): Promise<string | null>
    set(key: string, value: string): Promise<void>
    remove(key: string): Promise<void>
  }
}
```

### When each field is set

| Field | Timing | Source |
|-------|--------|--------|
| `config` | App boot (`initSpaceHost`) | `appConfig` |
| `auth` | App boot | Auth store lazy import |
| `space.id` | Per-space load (`SpaceLoader`) | Updated each time a space bundle executes |
| `project.id` | Reactive getter | Project store |
| `operator.send` | App boot | Lazy import of `useOperator` |
| `storage.*` | App boot | Lazy import of `useStorage` |

Source: `frontend/lib/spaceHost.ts`, `frontend/space_loader/SpaceLoader.ts`

## Version

`HOST_API_VERSION` in `spaceHost.ts` tracks breaking changes. Spaces can declare
a minimum version in `manifest.build.hostApiVersion`.
