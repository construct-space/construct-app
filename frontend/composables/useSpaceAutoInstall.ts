/**
 * Auto-install missing spaces silently with toast notifications.
 *
 * When a project references spaces that aren't installed,
 * this composable installs them from the marketplace registry.
 */

import { useSpaceMarketplace, NATIVE_SPACE_IDS } from '@/composables/useSpaceMarketplace'
import { useToast } from '@/composables/useToast'
import { useSpaces } from '@/composables/useSpaces'

const installing = new Set<string>()

export function useSpaceAutoInstall() {
  const marketplace = useSpaceMarketplace()
  const { add: addToast } = useToast()
  const { loadSpaces } = useSpaces()

  async function installMissing(missingIds: string[]): Promise<void> {
    // Deduplicate with in-progress installs, skip native host pages
    const toInstall = missingIds.filter(id => !installing.has(id) && !NATIVE_SPACE_IDS.has(id))
    if (toInstall.length === 0) return

    for (const id of toInstall) {
      installing.add(id)

      addToast({
        title: `Installing ${id}...`,
        color: 'info',
        duration: 3000,
      })

      try {
        const success = await marketplace.install(id)
        if (success) {
          addToast({
            title: `${id} installed`,
            color: 'success',
            duration: 3000,
          })
        } else {
          addToast({
            title: `Failed to install ${id}`,
            description: marketplace.error.value || undefined,
            color: 'error',
            duration: 5000,
          })
        }
      } catch (err) {
        addToast({
          title: `Failed to install ${id}`,
          description: err instanceof Error ? err.message : String(err),
          color: 'error',
          duration: 5000,
        })
      } finally {
        installing.delete(id)
      }
    }

    // Refresh spaces list after all installs complete
    await loadSpaces()
  }

  return { installMissing }
}
