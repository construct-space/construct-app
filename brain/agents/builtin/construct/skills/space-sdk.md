---
id: space-sdk
name: Construct SDK — host APIs for Spaces
description: The full contract Spaces get from @construct-space/sdk 1.2 — Pinia stores, composables, types, useBrain tier-routed completions. Read state from the store, not from caught API errors.
trigger: "useAuth,useAuthStore,useNavigator,useBreadcrumb,useAccess,useDownload,useExport,useImport,useStorage,useLocalStorage,useHttp,useDelivery,useNotification,useToast,useBrain,usePinned,usePreferences,useSettings,useSkills,useAuthorization,construct sdk,@construct-space/sdk,auth state,authenticated user,isAuthenticated,toast,routing,navigate,breadcrumb,acl,permission,download,export,import,blob storage,file storage,http client,email,notification,tier,brain.complete,brain.chat,summarize,llm from action,model from action"
category: construct
---

# Construct SDK (1.0)

`@construct-space/sdk` is the host-injection contract. Source of truth in
the app is `frontend/lib/constructSdk.ts`; it exports host stores,
composables, and types implemented under `frontend/stores/`,
`frontend/composables/`, and `frontend/types/`.

At build time you import from the package for autocomplete and types;
at runtime Vite externalizes it and Rollup rewrites every reference to
`window.__CONSTRUCT__['@construct-space/sdk']`, which the Construct app
populates before mounting any Space. Never bundle it — never ship your
own copy of these stores.

The legacy `@construct/sdk` alias still resolves to the same host slot
for old spaces; new code should import from `@construct-space/sdk`.

## Don't detect state by catching errors

Wrong: call an API, catch 401, infer the user is logged out. Slow
(failure round-trip), brittle (error shapes change), racy (two
components disagree in the same frame).

Right: read the authoritative state synchronously from the store.

```ts
import { useAuthStore } from '@construct-space/sdk'

const auth = useAuthStore()
if (!auth.isAuthenticated) {
  // show the sign-in prompt; don't try the API first
}
```

Same rule for preferences, pinned items. If the SDK exposes a store, it
IS the source of truth.

## Stores (Pinia)

From `frontend/stores/*.ts` via `frontend/lib/constructSdk.ts`:

| Store                       | What it holds                                     |
|-----------------------------|---------------------------------------------------|
| `useAuthStore()`            | `user`, `token`, `isAuthenticated`, `userName`, `userEmail`, `userAvatar`, OAuth login, `checkAuth()`, `logout()` |
| `usePinnedStore()`          | Pinned folders / pages / spaces / links / tasks. Helpers: `createFolderPin`, `createPagePin`, `createSpacePin`, `createLinkPin`, `createTaskPin` |
| `usePreferencesStore()`     | Theme, editor settings, toolbar, user-level UI prefs |
| `useSettingsStore()`        | App-wide settings (org/account, AI providers, design, …) |

Note: `useProjectStore` is gone — SDK 1.0 does not inject project
state into spaces. If a space needs project context, it must come
through declared inputs/actions, not by reaching into a host store.

## Composables — SDK 1.0 surface

Full export list starts in `frontend/lib/constructSdk.ts`; implementations
live in `frontend/composables/`. Group reach-for-most:

### Auth + identity
- `useAuthStore()` / `useAuth()` — current user + token. Prefer `useAuthStore()` in new code.
- `useAuthorization()` — role/permission checks (consolidated; the old `usePermissions` was merged in).
- `useAccess<T>(model, row)` — per-row ACL (ABAC). Personal context auto-permits; org rows consult the row's `acl` binding.
- `useOrgMembers()` — reactive org member roster; names normalized to `name || email || user_id`.

### Routing + chrome
- `useNavigator()` — GetX-style imperative routing: `push(path)`, `replace(path)`, `back()`, `forward()`, `currentPath`, `query`. Use this instead of importing vue-router primitives in spaces.
- `useBreadcrumb()` — toolbar trail: `{ set(items), push(item), clear() }`. Spaces own their breadcrumb while mounted; host clears on unmount.
- `useAppMenu()` — register menu contributions.
- `useToolbar()` — register toolbar contributions from the Space.
- `useContextMenus()` — register context-menu contributors.

### Storage — read these two together
There are **two** storage composables and they do different things. Pick wrong and you either lose data or bloat localStorage.

- `useLocalStorage(key, default?)` — KV in the browser's `localStorage`. Use for UI prefs (pinned, view mode, last-opened tab). **This is what the old `useStorage` was renamed to.**
- `useStorage()` — **file/blob storage** scoped to `<space-id>/<path>`. Use for user-uploaded files, exported reports, generated artifacts. Surface: `upload(file, opts)`, `presign(opts)`, `signedUrl(opts)`, `download(path)`, `delete(path)`, `list(opts)`, `exists(path)`. Backed by `api/storage/` (R2-backed) through the gateway — the gateway auth-injects the internal secret; spaces only need a valid user session. Bucket + key are derived host-side (`bucket=space-blobs`, `key=<space-id>/<path>`), spaces never pick buckets.

```ts
// transient UI state
const view = useLocalStorage('notes:view', 'grid')

// file upload
const storage = useStorage()
const { url } = await storage.upload(file, { path: `uploads/${file.name}` })
// `url` is the public R2 URL — usable in <img src> directly.
```

### Tier-routed LLM (`useBrain` — for actions, not chat UIs)

`useBrain()` exposes two methods space *actions* use to call the model
mid-execution: `complete({ prompt, tier? })` for one-shots, `chat({
messages, tier?, system? })` for multi-turn. Both are async, both return
`{ text, tier, provider, model, usage, elapsedMs, finishReason }`.

`tier: 'small' | 'medium' | 'large'` is the **cost bucket**. The host
resolves it to a concrete provider + model via the user's tier config
(Settings → LLM Providers). The space picks the bucket; the user owns
the slot. Per-call `tier` overrides the action's declared default.

Permission: the space manifest must declare `<space-id>:brain` in
`permissions.catalog`, and the action calling brain must be in
`permissions.actions` mapped to that id. Without the grant the call
fails synchronously with `BrainPermissionDenied`.

```ts
import { useBrain } from '@construct-space/sdk'
import type { SpaceActions } from '@construct-space/sdk'

export const actions: SpaceActions = {
  summarizeThread: {
    description: 'Summarize an email thread.',
    tier: 'small',
    params: { threadId: { type: 'string', required: true } },
    async run({ threadId }) {
      const brain = useBrain()
      if (!brain) return { error: 'brain unavailable' }
      const body = await loadThread(threadId as string)
      const { text } = await brain.complete({ prompt: `Summarize:\n${body}` })
      return { summary: text }
    },
  },
  composeReply: {
    description: 'Draft a polished reply.',
    tier: 'large',
    params: { original: { type: 'string', required: true } },
    async run({ original }) {
      const brain = useBrain()
      if (!brain) return { error: 'brain unavailable' }
      const { text } = await brain.chat({
        system: 'You write replies that feel like a thoughtful human wrote them.',
        messages: [{ role: 'user', content: String(original) }],
      })
      return { draft: text }
    },
  },
}
```

When to pick which tier (rule of thumb):
- **`small`** — summarisation, classification, extraction, short Q&A
- **`medium`** — general assistance, code edits, structured output
- **`large`** — long-form writing, deep reasoning, planning

Do **not** use `useBrain` for the space's main chat UI. That uses
`brain.prompt(...)` (the full agent loop with tools + sessions), not the
one-shot `complete/chat`. `useBrain().complete/chat` is for actions
that need a single model call and return JSON to the agent.

### IO
- `useHttp()` — Dio-style HTTP client: `get/post/put/delete/patch` plus request/response interceptors. Auth header + base URL are not pre-wired here; this is for arbitrary HTTP calls. (Construct service APIs go through dedicated host-injected composables, not raw `useHttp`.)
- `useDownload()` — file save helper: `save(blob, filename)`, `saveUrl(url, filename?)`.
- `useExport()` — rows → file: `export(rows, { format: 'csv'|'tsv'|'json'|'xlsx'|'markdown', filename })`.
- `useImport()` — file → rows: parse user-picked file back into JS objects.
- `useDelivery()` — transactional email + self-notify: `send({ to, subject, body })`, `notifySelf({ title, body })`.

### Feedback
- `useNotification()` — push/host notification surface (bell, inbox, push). Singular only — `useNotifications` (plural) is gone.
- `useToast()` — transient inline feedback (`toast.success('Saved')`, `toast.error(...)`). Re-exported from UI for convenience.

### Discovery + content
- `useSkills()`, `useSpaces()`, `useSpaceMarketplace()` — Space registry.
- `useMarkdown()` — sanitized markdown render.
- `useBilling()`, `useCredits()` — monetization state.
- `useDateFormat()` — date formatting helpers.

## What was removed in SDK 1.0

If you see these in older spaces, rewrite or strip them — they will not resolve at runtime:

- `useApi`, `useApiHealth`, `useSource` (alias) — spaces use `useHttp` for arbitrary HTTP, and host-injected composables for Construct services.
- `useAssistant`, `useOperator`, `useContextMode`, `useComponentContext`, `useTauriContext` — operator surface removed from SDK.
- `useDropdownPosition`, `usePanels`, `usePanelLayout`, `usePanelResize`, `usePanelsStore` — panel composables and store gone.
- `usePermissions` — folded into `useAuthorization`.
- `useProjectContext`, `useProjectDirectory`, `useProjectStore`, `useSpace` — Project removed from SDK; no project state injected into spaces.
- `useSpeechToText`, `useTextToSpeech` — voice removed.
- `useNotifications` (plural) — only the singular `useNotification` survives.
- `useTheme` / `useAppTheme` from either SDK or UI — UI 1.0 dropped it; host owns theming.

## Types

Host contract types live in `frontend/types/sdk.ts`. Common type-only
imports include `SpaceManifest`, `SpacePermission`, `ToolbarItem`,
`ToolbarBreadcrumb`, `SpaceToolbarItem`, `AclBinding`, `ActionResult`.

Import in the usual `import type { … } from '@construct-space/sdk'` style.

## When the SDK doesn't cover it

Space-specific persistent data → `@construct-space/graph` (see the
`graph` skill). Arbitrary HTTP → `useHttp()`. Anything else: open an
issue; don't fall back to raw fetch + bare localStorage.

## Vite config externals

Spaces that import from the SDK must externalize it so the host copy
is reused (otherwise Rollup bundles duplicates and you get two stores
in memory, producing stale state):

```ts
external: [
  'vue', 'vue-router', 'pinia', '@vueuse/core',
  '@construct-space/sdk', '@construct/sdk',   // legacy alias, keep during cutover
  '@construct-space/ui', '@construct-space/graph',
  // plus @tauri-apps/*, lucide-vue-next, date-fns, dexie, zod — full list in scaffold.md
],
```

`space_create` already ships with the full list. For older spaces
being migrated, copy the externals list from the scaffold template.
