/**
 * Bridge Listener — the Tauri transport side of the brain bridge.
 *
 * Listens for `bridge:request` events from Tauri (operator legacy +
 * native ops the webview can't perform: screenshots, mouse, browser).
 * Dispatches through the shared `useBrainBridge` table so brain's SSE
 * channel and operator's Tauri events resolve through the same handlers.
 *
 * The space.* / org.* / project.* defaults below register themselves
 * with the brain bridge at module load so they're available from
 * either transport without a component needing to mount.
 */

import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow'
import { invoke } from '@tauri-apps/api/core'
import { dispatch, registerDefault } from '@/brain/bridge'
import { getAutomationProvider, getActiveSpace, listAutomationProviders, requestSpaceData } from '@/lib/spaceContextBus'

interface BridgeRequest {
  id: string
  method: string
  params?: Record<string, unknown>
}

// Module-level pointer to the active Tauri listener so we can unregister
// it before registering a fresh one. Without this, HMR in dev leaves the
// previous listener dangling inside Tauri (closure still alive, module
// state reset) and two copies race for every bridge:request — one of
// them usually referencing stale automation providers and failing the
// `bridge_respond`, which manifests as "context deadline exceeded" on
// the operator side 30s later.
let unlisten: (() => void) | null = null

// Dev-only belt-and-braces: Vite HMR guarantees `import.meta.hot.dispose`
// fires before the new module evaluates, so we can tear down the old
// listener at the exact right moment. In prod this block is tree-shaken.
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    if (unlisten) {
      try { unlisten() } catch { /* listener already gone */ }
      unlisten = null
    }
  })
}

/**
 * Start listening for bridge:request events from Tauri.
 * Call once at app startup — only in the main window. Safe to call
 * again after an HMR cycle; any previous listener is unregistered
 * before the new one is attached.
 */
export async function startBridgeListener(): Promise<void> {
  // Clean-up any listener this module still holds. The dispose hook
  // above normally handles HMR, but a double-call from bootstrap (or
  // a test) should also be idempotent rather than leaking listeners.
  if (unlisten) {
    try { unlisten() } catch { /* ignore */ }
    unlisten = null
  }

  // Window-scoped listen: only receives events targeted at this webview window.
  // Rust uses emit_to(&main_window, ...) so only this listener receives bridge requests.
  const currentWindow = getCurrentWebviewWindow()
  unlisten = await currentWindow.listen<BridgeRequest>('bridge:request', async (event) => {
    const { id, method, params } = event.payload
    try {
      const result = await dispatch(method, params ?? {})
      await invoke('bridge_respond', { id, result })
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      await invoke('bridge_respond', {
        id,
        result: { error: message },
      })
    }
  })
}

/**
 * Stop the bridge listener.
 */
export function stopBridgeListener(): void {
  if (unlisten) {
    unlisten()
    unlisten = null
  }
}

// Default handlers — the always-available dispatch table. Vue components
// that need to override (e.g. PermissionGate registering `permission.request`)
// do so via useBrainBridge().register(). The default registry below covers
// the space.*/org.*/project.* surface that doesn't need a component mount.
// `ping` is the operator's reachability probe (system.info → bridge.Ping).
// No-op response is enough; the operator only checks for a successful call.
registerDefault('ping', async () => ({ ok: true }))
registerDefault('space.snapshot', (p) => handleSpaceSnapshot(p))
registerDefault('space.directory', () => handleSpaceDirectory())
registerDefault('space.list_actions', (p) => handleSpaceListActions(p))
registerDefault('space.agent', (p) => handleSpaceAgent(p))
registerDefault('space.run_action', (p) => handleSpaceRunAction(p))
registerDefault('space.context_request', (p) => handleSpaceContextRequest(p))
registerDefault('space.open_runner', (p) => handleOpenRunner(p))
registerDefault('space.open_preview', (p) => handleOpenPreview(p))
registerDefault('space.navigate', (p) => handleSpaceNavigate(p))
registerDefault('project.create_modal', (p) => handleProjectCreateModal(p))
registerDefault('org.members', () => handleOrgMembers())
registerDefault('org.projects', () => handleOrgProjects())
registerDefault('org.my_role', () => handleOrgMyRole())

// permission.request + user.ask are intentionally NOT registered as
// defaults — they're component-owned (PermissionGate.vue, AskUserHost.vue).
// If brain fires one before the host mounts, dispatch throws "unknown
// bridge method" and brain's tool execution surfaces the error to the
// model, which is the right failure mode for "no UI to consent".

async function handleOrgMyRole() {
  const { useAuthStore } = await import('@/stores/auth')
  const { useOrgStore } = await import('@/stores/org')
  const auth = useAuthStore()
  const org = useOrgStore()
  const roles = auth.roles || []
  // Union of permission strings granted by every role the user holds in
  // this org. Roles are defined in /org/roles; each carries a permissions
  // string array (e.g. "board:delete", "members:invite"). Spaces declare
  // these strings in their manifest under `permissions.actions`.
  const active = new Set(roles.map(r => r.trim().toLowerCase()))
  const perms = new Set<string>()
  for (const r of org.roles || []) {
    if (!active.has(r.name.trim().toLowerCase())) continue
    for (const p of r.permissions || []) perms.add(p)
  }
  // Owners (and admins) bypass per-permission gating — represent this as
  // the wildcard "*" so consumers (settings UI, agent prompt) can render
  // a "granted" state for every catalog entry without needing to know
  // every permission string up front.
  const is_owner = roles.includes('owner')
  const is_admin = is_owner || roles.includes('admin')
  if (is_admin) perms.add('*')
  return {
    in_org: !!org.isEnabled,
    user_id: auth.user?.id || null,
    scope: auth.scope,
    roles,
    is_owner,
    is_admin,
    is_member: roles.length > 0,
    permissions: [...perms].sort(),
  }
}

async function handleOrgMembers() {
  const { useOrgStore } = await import('@/stores/org')
  const org = useOrgStore()
  if (!org.isEnabled) return { members: [], in_org: false }
  return {
    in_org: true,
    members: org.members.map(m => ({
      id: m.id,
      user_id: m.user_id,
      name: m.name,
      email: m.email,
      title: m.title,
      role: m.role,
      department_id: m.department_id,
      status: m.status,
    })),
  }
}

async function handleOrgProjects() {
  const { useOrgStore } = await import('@/stores/org')
  const org = useOrgStore()
  if (!org.isEnabled) return { in_org: false, projects: [] }
  // Source of truth: source.construct.space `/org/projects` API (same source
  // the OrgProjectsPage uses). The local project store only mirrors projects
  // the user has opened locally — agents need the full org list.
  try {
    const { useSource } = await import('@/composables/useSource')
    const api = useSource()
    type OrgProject = {
      id: string
      name: string
      description?: string
      repo_url?: string
      default_branch?: string
      framework?: string
      created_at?: string
      updated_at?: string
    }
    const data = await api.get<OrgProject[]>('/org/projects')
    const list = Array.isArray(data) ? data : []
    return {
      in_org: true,
      projects: list.map(p => ({
        id: p.id,
        name: p.name,
        description: p.description,
        repo_url: p.repo_url,
        default_branch: p.default_branch,
        framework: p.framework,
      })),
    }
  } catch (e) {
    return { in_org: true, projects: [], error: e instanceof Error ? e.message : String(e) }
  }
}

/**
 * Open the New Project modal prefilled with a suggested name/description.
 * Resolves after the user confirms (with { path, name }) or cancels
 * (with { cancelled: true }). Times out implicitly via the Rust-side
 * 30s oneshot channel if the user ignores the dialog.
 *
 * The modal itself is rendered by an app-level host (see projectSetupHost)
 * so it's always mounted regardless of which page the user is on.
 */
async function handleProjectCreateModal(
  params: Record<string, unknown>,
): Promise<{ path: string; name: string } | { cancelled: true }> {
  const { requestProjectSetup } = await import('@/lib/projectSetupHost')
  const suggestedName = (params.suggested_name as string) || ''
  const suggestedDescription = (params.suggested_description as string) || ''
  return requestProjectSetup({ suggestedName, suggestedDescription })
}

// Well-known app destinations that aren't installed spaces but live on the
// same /app/<id> router base. Lets the agent navigate to e.g. the Space Store
// by a natural name instead of failing because it's not in list_spaces.
const NAV_ALIASES: Record<string, string> = {
  'space store': 'marketplace',
  spacestore: 'marketplace',
  'space-store': 'marketplace',
  store: 'marketplace',
}

async function handleSpaceNavigate(params: Record<string, unknown>) {
  const raw = typeof params.space_id === 'string' ? params.space_id.trim() : ''
  if (!raw) {
    throw new Error('navigate_space requires `space_id`')
  }
  const spaceId = NAV_ALIASES[raw.toLowerCase()] ?? raw
  const page = typeof params.page === 'string' ? params.page : undefined
  const prompt = typeof params.prompt === 'string' ? params.prompt : undefined
  const { navigateToSpace } = await import('@/lib/spaceNavigation')
  await navigateToSpace({
    spaceId,
    ...(page ? { page } : {}),
    ...(prompt ? { query: { q: prompt } } : {}),
  })
  return { ok: true, space_id: spaceId }
}

async function handleSpaceSnapshot(params: Record<string, unknown>) {
  const spaceId = resolveSpaceId(params)
  const provider = getAutomationProvider(spaceId)
  if (!provider) {
    // Spaces without registered actions (e.g. games, viewers) are valid —
    // return a minimal snapshot rather than erroring out.
    return { space_id: spaceId, title: spaceId, state: {}, actions: [] }
  }
  return await provider.snapshot()
}

/**
 * Installed-spaces directory for brain's system prompt: every installed
 * space's id, name, description, and action ids. Names/descriptions come
 * from manifests (core registry + app data dir); action lists come from
 * the automation provider registry, which is fully populated at startup
 * (registerCoreSpaceProviders + preloadSpaceActions) — so no space needs
 * to be open for its actions to appear here.
 */
async function handleSpaceDirectory() {
  const actionsFor = (spaceId: string): Array<{ id: string; description: string }> => {
    const provider = getAutomationProvider(spaceId)
    if (!provider) return []
    try {
      return provider.listActions().map(a => ({ id: a.id, description: a.description }))
    } catch {
      return []
    }
  }

  type DirectoryEntry = {
    id: string
    name: string
    description: string
    actions: Array<{ id: string; description: string }>
  }
  const entries: DirectoryEntry[] = []
  const seen = new Set<string>()

  try {
    const { useSpaces } = await import('@/composables/useSpaces')
    const registry = useSpaces()
    // lite: the directory only needs id/name/description/actions — skip
    // per-icon file reads AND the global theme registration (a non-lite
    // load here would overwrite sidebar icons with un-inlined paths).
    await registry.loadSpaces({ lite: true })
    for (const cfg of registry.spaces.value) {
      seen.add(cfg.name)
      entries.push({
        id: cfg.name,
        name: cfg.displayName,
        description: cfg.description,
        actions: actionsFor(cfg.name),
      })
    }
  } catch (e) {
    console.warn('[bridge] space.directory manifest scan failed:', e)
  }

  // Providers without a manifest entry (dev-linked spaces, runtime-only
  // registrations) still belong in the directory — id doubles as name.
  for (const id of listAutomationProviders()) {
    if (seen.has(id)) continue
    entries.push({ id, name: id, description: '', actions: actionsFor(id) })
  }

  return { spaces: entries, active: getActiveSpace() }
}

async function handleSpaceListActions(params: Record<string, unknown>) {
  const spaceId = resolveSpaceId(params)
  const provider = getAutomationProvider(spaceId)
  if (!provider) {
    return { space_id: spaceId, actions: [] }
  }
  return {
    space_id: spaceId,
    actions: provider.listActions(),
  }
}

// Returns the installed space's agent/config.md (raw markdown) so brain can
// run that as the per-space agent's system prompt. Empty on any miss — brain
// falls back to the built-in construct agent.
async function handleSpaceAgent(params: Record<string, unknown>) {
  const spaceId = resolveSpaceId(params)
  try {
    const { createSpaceSource } = await import('@/space_loader/SpaceSource')
    const src = await createSpaceSource(spaceId)
    if (src && (await src.entryExists('agent/config.md'))) {
      return { space_id: spaceId, markdown: await src.readText('agent/config.md') }
    }
  } catch (e) {
    console.warn('[bridge] space.agent failed for', spaceId, e)
  }
  return { space_id: spaceId, markdown: '' }
}

async function handleSpaceRunAction(params: Record<string, unknown>) {
  const spaceId = resolveSpaceId(params)
  const action = params.action as string
  // The operator binary's tool schema names the action args field `params`;
  // earlier docs say `payload`. Accept either so a mismatched schema doesn't
  // silently drop the agent's arguments and leave the action with `{}`.
  const payload = (params.payload as Record<string, unknown>)
    ?? (params.params as Record<string, unknown>)
    ?? (params.args as Record<string, unknown>)
    ?? {}

  if (!action) {
    throw new Error('space.run_action requires an "action" parameter')
  }

  const provider = getAutomationProvider(spaceId)
  if (!provider) {
    throw new Error(`No automation provider registered for space: ${spaceId}`)
  }
  return await provider.runAction(action, payload)
}

/**
 * Resolve space ID from params.
 * Priority: explicit param > active space from router > error.
 *
 * Accepts `space_id` (canonical) and `space` (operator-binary shorthand).
 */
function resolveSpaceId(params: Record<string, unknown>): string {
  // 1. Explicit space_id / space in request
  if (params.space_id && typeof params.space_id === 'string') {
    return params.space_id
  }
  if (params.space && typeof params.space === 'string') {
    return params.space
  }

  // 2. Currently active space (tracked by router)
  const active = getActiveSpace()
  if (active) {
    return active
  }

  // 3. No active space — error, don't guess
  throw new Error('No active space. Navigate to a space or pass space_id explicitly.')
}

async function handleSpaceContextRequest(params: Record<string, unknown>) {
  const spaceId = resolveSpaceId(params)
  const request = params.request as { type: string; [key: string]: unknown } | undefined
  if (!request?.type) {
    throw new Error('space.context_request requires a request.type')
  }
  const result = await requestSpaceData(spaceId, request)
  return result ?? { error: `No handler for space "${spaceId}"` }
}

async function handleOpenRunner(params: Record<string, unknown>) {
  const { useSpaceRunner } = await import('@/composables/useSpaceRunner')
  const { openRunner } = useSpaceRunner()

  const spaceId = params.space_id as string | undefined
  const rawPath = params.project_path as string | undefined

  // Agents typically call `space_runner({space_id})` to test what they just
  // built — they want a DEV PREVIEW window, not the installed-space popout.
  // Resolve a project_path even when the caller omits it: prefer the active
  // project in the store, then find `space-<id>/dist/` under it. This makes
  // `space_runner` default to preview mode automatically.
  const resolvedRaw = rawPath ?? await inferActiveProjectPath()
  const projectPath = await resolveRunnerDir(resolvedRaw, spaceId)

  await openRunner({
    spaceId,
    projectPath,
    // Keep the project root as context so the runner sidebar can enumerate
    // sibling subspaces via .construct/project.json.
    project: projectRootFromPath(resolvedRaw, projectPath),
  })
  return { ok: true }
}

async function inferActiveProjectPath(): Promise<string | undefined> {
  try {
    const { useProjectStore } = await import('@/stores/project')
    const store = useProjectStore()
    const p = store.currentProject
    return p?.local_path || p?.path || undefined
  } catch { return undefined }
}

async function resolveRunnerDir(rawPath: string | undefined, spaceId: string | undefined): Promise<string | undefined> {
  if (!rawPath) return undefined
  try {
    const { exists } = await import('@tauri-apps/plugin-fs')
    const { isSpaceBundleEntry } = await import('@/space_loader/spaceBundleResolver')
    // Already a .space bundle or a dist/ directory containing one?
    if (await exists(`${rawPath}/manifest.json`)) return rawPath
    if (spaceId && (await exists(`${rawPath}/${spaceId}.space/manifest.json`) || await exists(`${rawPath}/${spaceId}.space`))) return rawPath
    // Source dir with a sibling dist/<id>.space?
    if (spaceId && (await exists(`${rawPath}/dist/${spaceId}.space/manifest.json`) || await exists(`${rawPath}/dist/${spaceId}.space`))) return `${rawPath}/dist`
    // Project root with a `space-<id>/dist/<id>.space` inside?
    if (spaceId && (await exists(`${rawPath}/space-${spaceId}/dist/${spaceId}.space/manifest.json`) || await exists(`${rawPath}/space-${spaceId}/dist/${spaceId}.space`))) {
      return `${rawPath}/space-${spaceId}/dist`
    }
    // Last resort: single space-*/dist/*.space in the project (no id passed, one space)
    if (!spaceId) {
      const { readDir } = await import('@tauri-apps/plugin-fs')
      try {
        const rawEntries = await readDir(rawPath)
        if (rawEntries.some(e => isSpaceBundleEntry(e))) {
          return rawPath
        }
        const candidates = rawEntries.filter(e => e.isDirectory && e.name?.startsWith('space-'))
        for (const e of candidates) {
          const distEntries = await readDir(`${rawPath}/${e.name}/dist`)
          const bundle = distEntries.find(d => isSpaceBundleEntry(d))
          if (!bundle?.name) continue
          const dist = `${rawPath}/${e.name}/dist/${bundle.name}`
          if (await exists(`${dist}/manifest.json`) || await exists(dist)) return `${rawPath}/${e.name}/dist`
        }
      } catch { /* ignore — permission or missing dir */ }
    }
  } catch { /* fall through */ }
  return rawPath
}

// Figure out the project root for the sidebar's subspace enumeration.
// - If the caller passed the project root (no dist resolution happened),
//   use its parent.
// - If we resolved `<root>/space-<id>/dist`, strip the two trailing segments.
// - If the caller passed `<src>/dist`, the parent-of-parent is the project.
function projectRootFromPath(rawPath: string | undefined, resolved: string | undefined): string | undefined {
  if (rawPath && resolved && rawPath !== resolved) {
    // Resolved differs → we walked into dist. Strip to project root.
    // `<root>/space-<id>/dist` → `<root>`; `<src>/dist` → `<src parent>`.
    const parts = resolved.split('/')
    if (parts[parts.length - 1] === 'dist') {
      return parts.slice(0, -2).join('/') || undefined
    }
  }
  if (rawPath) return rawPath
  if (resolved) {
    const parts = resolved.split('/')
    if (parts[parts.length - 1] === 'dist') {
      return parts.slice(0, -2).join('/') || undefined
    }
  }
  return undefined
}

async function handleOpenPreview(params: Record<string, unknown>) {
  // Unified preview dispatcher. Accepts both shapes:
  //   Old (space_preview alias):
  //     { space_id, project_path?, width?, height? }
  //   New (preview):
  //     { target, type: 'space'|'web', width?, height?, device?, project_path?, title? }
  //
  // Routing:
  //   type:'space' | no type + space_id → lightweight SpacePreviewShell
  //   type:'web' → WebPreviewShell with Tauri child webview (dev servers,
  //                static sites, device-sized responsive checks)
  const { openPreview } = await import('@/lib/window/openWindow')
  const typeRaw = typeof params.type === 'string' ? params.type : null
  const target = (params.target as string) ?? (params.space_id as string) ?? ''
  if (!target) throw new Error('preview requires target (or space_id)')

  const width  = typeof params.width  === 'number' ? params.width  : undefined
  const height = typeof params.height === 'number' ? params.height : undefined

  if (typeRaw === 'web') {
    const device = (typeof params.device === 'string'
      ? params.device
      : undefined) as 'mobile' | 'tablet' | 'desktop' | 'custom' | undefined
    const title = typeof params.title === 'string' ? params.title : undefined
    await openPreview(target, { type: 'web', width, height, device, title })
    return { ok: true }
  }

  // Default: space preview (back-compat for space_preview callers).
  const rawPath = params.project_path as string | undefined
  const resolvedRaw = rawPath ?? await inferActiveProjectPath()
  const projectPath = await resolveRunnerDir(resolvedRaw, target)
  await openPreview(target, { type: 'space', projectPath, width, height })
  return { ok: true }
}
