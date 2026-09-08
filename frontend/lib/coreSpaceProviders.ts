/**
 * Core space automation providers — registered once at app startup.
 *
 * Host-native spaces (org, project, org-project) used to register their
 * AutomationProvider on page mount, which meant brain's space_run_action
 * failed with "No automation provider registered" for any space the user
 * hadn't opened this session. Dynamic spaces don't have that gap —
 * preloadSpaceActions() registers lazy providers from their manifests at
 * startup. This is the host-native counterpart: the providers are pure
 * store-backed (no UI dependency), registered permanently at startup.
 *
 * The set of providers is NOT maintained here — it's derived from the
 * `createAutomationProvider` field on CORE_SPACES entries (coreSpaces.ts),
 * so adding a host-native space with actions is a single edit in the
 * registry that already owns host-native spaces.
 */

import { registerAutomationProvider, getAutomationProvider } from '@/lib/spaceContextBus'
import { getCoreSpaceProviderFactories } from '@/space_loader/coreSpaces'

export async function registerCoreSpaceProviders(): Promise<void> {
  // Main app windows only. Preview/detach windows have their own pinia
  // with unhydrated, possibly unauthenticated stores — a core provider
  // registered there serves confidently-wrong data (and an early
  // org.fetchAll failure would even persist enabled:false to the shared
  // profile-scoped storage). Those windows keep the explicit
  // "no registered actions" error instead.
  const { getWindowLabel, resolveWindowTypeFromLabel } = await import('@/lib/window/windowType')
  if (resolveWindowTypeFromLabel(await getWindowLabel()) !== 'main') return

  for (const [id, createProvider] of getCoreSpaceProviderFactories()) {
    if (getAutomationProvider(id)) continue
    try {
      registerAutomationProvider(id, createProvider())
    } catch (e) {
      console.warn(`[coreSpaceProviders] register failed for "${id}":`, e)
    }
  }
}
