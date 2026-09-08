/**
 * useOrgSpacesSync — auto-install spaces pinned by the org admin.
 *
 * Runs once per session (in-memory flag) when the app boots into an
 * authenticated, org-enabled state. Fetches `/api/org/spaces`, diffs
 * against locally installed spaces, and installs anything missing in
 * the background. Failures are logged but don't surface to the user
 * — auto-install is a convenience, not a hard requirement.
 *
 * Removing a pin server-side does NOT uninstall locally; this matches
 * the v1 design (admins say "everyone gets X" but pulling the rug
 * doesn't auto-revoke from members' machines).
 */
import { useAuthStore } from '@/stores/auth'
import { useOrgStore } from '@/stores/org'
import { useSpaceMarketplace } from '@/composables/useSpaceMarketplace'
import { useSource } from '@/composables/useSource'

interface OrgSpacePin {
  space_id: string
}

let inFlight: Promise<void> | null = null
let didRunForOrg: string | null = null

export function useOrgSpacesSync() {
  const authStore = useAuthStore()
  const orgStore = useOrgStore()
  const marketplace = useSpaceMarketplace()
  const api = useSource()

  async function run(): Promise<void> {
    // Guards: must be authenticated, in an org, and not already syncing.
    if (!authStore.token) return
    if (!orgStore.isEnabled || !orgStore.orgId) return
    if (didRunForOrg === orgStore.orgId) return
    if (inFlight) return inFlight

    const orgId = orgStore.orgId
    inFlight = (async () => {
      try {
        const pins = await api.get<OrgSpacePin[]>('/org/spaces').catch(() => [] as OrgSpacePin[])
        if (!Array.isArray(pins) || pins.length === 0) return

        // Refresh installed list so we don't reinstall something the
        // user already has (e.g. they installed it manually before
        // the admin pinned it).
        try { await marketplace.fetchInstalled() } catch { /* best-effort */ }

        const missing = pins.filter(p => !marketplace.isInstalled(p.space_id))
        if (missing.length === 0) return

        console.log(`[OrgSpacesSync] Installing ${missing.length} pinned space(s):`, missing.map(p => p.space_id))
        for (const pin of missing) {
          try {
            const ok = await marketplace.install(pin.space_id)
            if (!ok) console.warn(`[OrgSpacesSync] install returned false for ${pin.space_id}`)
          } catch (e) {
            console.warn(`[OrgSpacesSync] install failed for ${pin.space_id}:`, e)
          }
        }
      } finally {
        didRunForOrg = orgId
        inFlight = null
      }
    })()
    return inFlight
  }

  function reset() {
    didRunForOrg = null
    inFlight = null
  }

  return { run, reset }
}
