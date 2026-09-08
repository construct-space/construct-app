import { computed, ref } from 'vue'
import { IS_DEV_INSTANCE } from '@/lib/appPaths'
import { useAuthStore } from '@/stores/auth'

/**
 * Developer mode — gated by server-side enrollment only.
 *
 * developer_status: 'none' | 'pending' | 'enrolled' | 'rejected' | 'suspended'
 *
 * Consumers should use `isEnrolled` to gate developer features. The old
 * `isDeveloperMode` alias — which OR-ed enrollment with IS_DEV_INSTANCE —
 * has been removed: dev-instance binaries no longer unlock developer
 * capabilities, so testing from a signed release is the only path and
 * users who bugfix against one don't accidentally ship code that
 * required a privilege their end users never had.
 *
 * Local developer.json still carries user preferences for the updater
 * (disableUpdates), since that's an app-level preference unrelated to
 * whether the server considers you a developer.
 */

interface DeveloperConfig {
  disableUpdates: boolean
}

// Local preferences only. `developerStatus` used to live here as a ref
// that init() populated once from the auth store, but that snapshotted
// whatever auth was at first call — enrolled users who signed in after
// the first useDevMode() consumer stayed stuck on 'none' forever because
// nothing re-ran init. It's now a computed derived live from the store
// so Pinia reactivity carries enrollment updates through automatically.
const disableUpdates = ref(false)
let _configLoaded = false

async function loadConfig(): Promise<DeveloperConfig | null> {
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    const { readTextFile, exists } = await import('@tauri-apps/plugin-fs')
    const dataDir = (await invoke<string>('get_data_dir')).replace(/\/$/, '')
    const path = `${dataDir}/developer.json`
    if (await exists(path)) {
      return JSON.parse(await readTextFile(path))
    }
  } catch { /* not in Tauri or file doesn't exist */ }
  return null
}

async function saveConfig() {
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    const { writeTextFile, mkdir, exists } = await import('@tauri-apps/plugin-fs')
    const dataDir = (await invoke<string>('get_data_dir')).replace(/\/$/, '')
    if (!await exists(dataDir)) {
      await mkdir(dataDir, { recursive: true })
    }
    const config: DeveloperConfig = {
      disableUpdates: disableUpdates.value,
    }
    await writeTextFile(`${dataDir}/developer.json`, JSON.stringify(config, null, 2))
  } catch { /* best-effort */ }
}

/**
 * Merge the publisher identity (name + api key) into auth.json. Keeping
 * all credentials in a single file means the CLI, operator, and space
 * runtime have ONE place to look instead of juggling a separate
 * credentials.json. Preserves every other field the auth store persisted.
 */
interface PublisherRecord {
  name?: string
  kind?: string
  api_key?: string
  apiKey?: string
  orgId?: string
  org_id?: string
}

export async function writePublisherToAuthJson(apiKey: string, publisher: PublisherRecord | undefined) {
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    const { readTextFile, writeTextFile, mkdir, exists } = await import('@tauri-apps/plugin-fs')
    const dataDir = (await invoke<string>('get_data_dir')).replace(/\/$/, '')
    if (!await exists(dataDir)) {
      await mkdir(dataDir, { recursive: true })
    }
    const path = `${dataDir}/auth.json`

    // Read-modify-write so we don't clobber user/token fields the auth
    // store wrote earlier. If auth.json is missing, we still create it
    // with the publisher block — the auth store will fill in the rest on
    // its next persist cycle.
    let existing: Record<string, unknown> = {}
    if (await exists(path)) {
      try { existing = JSON.parse(await readTextFile(path)) } catch { /* overwrite */ }
    }
    const kind = publisher?.kind || 'user'
    const orgId = publisher?.orgId || publisher?.org_id
    existing.publisher = {
      name: publisher?.name || '',
      kind,
      api_key: apiKey,
      // Stamp orgId for org publishers so a later org-switch can detect
      // "this key is for a different org" and trigger a re-sync.
      ...(kind === 'org' && orgId ? { orgId } : {}),
    }
    existing.updated_at = new Date().toISOString()
    await writeTextFile(path, JSON.stringify(existing, null, 2))
  } catch { /* best-effort — enrollment still succeeded on server */ }
}

/**
 * syncPublisherCredentials — ensure auth.json's publisher block matches
 * the active scope. Fetches from dev-portal /api/auth/cli-verify and
 * writes the right publisher (personal user or current org). Skips when
 * the stored publisher already matches scope+orgId so the file is only
 * rewritten on real changes.
 *
 * Exported (not just inside the composable) so refreshScope in the auth
 * store can call it without an import cycle through useDevMode().
 */
export async function syncPublisherCredentials(): Promise<void> {
  try {
    const { useConstructAuth } = await import('@/composables/useConstructAuth')
    const authStore = useAuthStore()
    const token = authStore.oauthToken || authStore.token
    if (!token) return

    const { invoke } = await import('@tauri-apps/api/core')
    const { readTextFile, exists } = await import('@tauri-apps/plugin-fs')
    const dataDir = (await invoke<string>('get_data_dir')).replace(/\/$/, '')
    const path = `${dataDir}/auth.json`

    // Decide whether the on-disk publisher already matches the active
    // scope. If it does, skip the fetch. If it doesn't (e.g. the user
    // switched from personal → org, or org-A → org-B), fall through and
    // re-sync.
    const wantOrg = authStore.scope === 'org' && !!authStore.orgId
    if (await exists(path)) {
      try {
        const existing = JSON.parse(await readTextFile(path)) as {
          publisher?: { api_key?: string; kind?: string; orgId?: string }
        }
        const pub = existing?.publisher
        if (pub?.api_key) {
          const matches = wantOrg
            ? pub.kind === 'org' && pub.orgId === authStore.orgId
            : pub.kind === 'user'
          if (matches) return
        }
      } catch { /* malformed — fall through */ }
    }

    const auth = useConstructAuth()
    const accountsUrl = (auth as unknown as { accountsUrl?: string }).accountsUrl
      || 'https://my.construct.space'
    const resp = await fetch(`${accountsUrl}/api/developer/auth/cli-verify`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!resp.ok) return
    const data = await resp.json() as {
      publishers?: Array<{ name: string; kind: string; orgId?: string; api_key?: string }>
    }
    const pick = (wantOrg
      ? data.publishers?.find(p => p.kind === 'org' && p.orgId === authStore.orgId && p.api_key)
      : data.publishers?.find(p => p.kind === 'user' && p.api_key))
      || data.publishers?.find(p => p.api_key)
    if (pick?.api_key) {
      await writePublisherToAuthJson(pick.api_key, pick)
    }
  } catch { /* best-effort — silent */ }
}

async function loadLocalConfig() {
  if (_configLoaded) return
  _configLoaded = true
  const config = await loadConfig()
  if (config) {
    disableUpdates.value = config.disableUpdates
  }
}

export function useDevMode() {
  loadLocalConfig()

  const isDevInstance = IS_DEV_INSTANCE

  // Live from the auth store so refreshScope() / login propagate without
  // anyone needing to re-run init. authStore.isDeveloper already covers
  // personal-scope (personalDeveloper flag) and org-scope (developer role).
  const developerStatus = computed(() => {
    try {
      const authStore = useAuthStore()
      if (authStore.isDeveloper) return 'enrolled'
      if (authStore.isOrgManaged && authStore.orgDeveloperStatus) return authStore.orgDeveloperStatus
      if (authStore.user?.developer_status) return authStore.user.developer_status
    } catch { /* pinia not ready yet */ }
    return 'none'
  })

  const isEnrollmentPending = computed(() => developerStatus.value === 'pending')
  const isEnrolled = computed(() => developerStatus.value === 'enrolled')

  // Updater stays disabled on dev instances and in `vite dev` — those
  // builds aren't signed and the Tauri updater would fail the minisign
  // check on every payload. Also honors the user's local toggle.
  const updaterDisabled = computed(() => IS_DEV_INSTANCE.value || import.meta.env.DEV || disableUpdates.value)

  /** Request personal developer enrollment. Org enrollment is a separate
   * flow exposed in Org Settings → Developer, since it requires org-admin
   * authority and operates on a different identity. */
  async function requestEnrollment(): Promise<{ status: string; message: string }> {
    try {
      const { useConstructAuth } = await import('@/composables/useConstructAuth')
      const auth = useConstructAuth()
      const authStore = useAuthStore()
      const token = authStore.oauthToken || authStore.token
      if (!token) return { status: 'error', message: 'Not authenticated' }

      // Developer endpoints route through the my.construct.space gateway
      // at /api/developer/* — the gateway strips /api/developer/ and
      // forwards to the developer service's own /api/* routes.
      const accountsUrl = (auth as unknown as { accountsUrl?: string }).accountsUrl
        || 'https://my.construct.space'
      const response = await fetch(`${accountsUrl}/api/developer/enroll/personal`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      })
      const data = await response.json()
      if (response.ok && data.publisher) {
        // Refresh auth scope so `developerStatus` (a computed over the
        // store) flips to 'enrolled' automatically.
        await authStore.refreshScope()
        // Enrollment response includes the freshly-created API key.
        // Persist to auth.json so CLI + operator graph tools + space
        // runtime all auth without the user copy-pasting from the portal.
        const apiKey = data.apiKey || data.api_key
        if (apiKey) await writePublisherToAuthJson(apiKey, data.publisher)
        return { status: 'enrolled', message: data.message || 'Enrolled successfully' }
      }
      return {
        status: 'error',
        message: data.error || data.detail || 'Enrollment failed',
      }
    } catch (err) {
      return { status: 'error', message: err instanceof Error ? err.message : 'Failed to enroll' }
    }
  }

  /** Refresh developer status — re-resolves scope from accounts /me/scope,
   * which calls source + developer and is the canonical source of truth
   * for the user's current developer capability. Also syncs the publisher
   * API key from the dev portal into auth.json if we don't already have
   * one locally — covers users who enrolled via the web. */
  async function refreshStatus() {
    try {
      const authStore = useAuthStore()
      await authStore.refreshScope()
      if (authStore.isDeveloper) {
        await syncPublisherCredentials()
      }
    } catch { /* best-effort */ }
  }

  function setDisableUpdates(val: boolean) {
    disableUpdates.value = val
    saveConfig()
  }

  return {
    isDevInstance,
    developerStatus,
    isEnrollmentPending,
    isEnrolled,
    disableUpdates,
    updaterDisabled,
    requestEnrollment,
    refreshStatus,
    setDisableUpdates,
  }
}
