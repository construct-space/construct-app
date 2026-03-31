/**
 * Error-to-action mapping for space load failures.
 *
 * Maps each error phase to actionable user suggestions so the error panel
 * in DynamicSpacePage.vue can show specific fix buttons.
 */

/** Phases where a space load can fail */
export type SpaceLoadErrorPhase =
  | 'checksum_mismatch'
  | 'version_incompatible'
  | 'missing_bundle'
  | 'missing_manifest'
  | 'agent_config_missing'
  | 'eval_failed'
  | 'no_pages_exported'
  | 'css_injection_failed'
  | 'disk_read_failed'
  | 'disabled'
  | 'unknown'

/** An actionable suggestion for the user */
export interface ErrorAction {
  label: string
  description: string
  route?: string
  type: 'navigate' | 'command' | 'info'
  command?: string
}

/** Map a SpaceLoadErrorPhase to user-facing suggestions */
export function getErrorActions(phase: SpaceLoadErrorPhase): ErrorAction[] {
  switch (phase) {
    case 'checksum_mismatch':
      return [
        { label: 'Re-download from marketplace', description: 'The space bundle integrity check failed. Re-installing will download a fresh copy.', route: '/app/marketplace', type: 'navigate' },
        { label: 'Check disk for errors', description: 'A corrupted file system can cause checksum mismatches.', type: 'info' },
      ]
    case 'version_incompatible':
      return [
        { label: 'Update Construct', description: 'This space requires a newer version of Construct.', route: '/app/settings/updates', type: 'navigate' },
        { label: 'Update space', description: 'Install the latest version of this space from the marketplace.', route: '/app/marketplace', type: 'navigate' },
      ]
    case 'missing_bundle':
      return [{ label: 'Re-install space', description: 'The space bundle file is missing. Re-installing will restore it.', route: '/app/marketplace', type: 'navigate' }]
    case 'missing_manifest':
      return [{ label: 'Re-install space', description: 'The manifest.json is missing from the space directory.', route: '/app/marketplace', type: 'navigate' }]
    case 'agent_config_missing':
      return [
        { label: 'Run construct validate', description: 'Validate the space configuration and regenerate missing agent config files.', type: 'command', command: 'construct validate' },
        { label: 'Check space settings', description: 'Verify the space is properly configured in Settings.', route: '/app/settings/spaces', type: 'navigate' },
      ]
    case 'eval_failed':
      return [
        { label: 'Re-install space', description: 'The space bundle failed to execute. A fresh install may fix the issue.', route: '/app/marketplace', type: 'navigate' },
        { label: 'Report issue', description: 'This may be a bug in the space. Report it to the space author.', type: 'info' },
      ]
    case 'no_pages_exported':
      return [{ label: 'Re-install space', description: 'The space bundle loaded but did not export any pages.', route: '/app/marketplace', type: 'navigate' }]
    case 'css_injection_failed':
      return [{ label: 'Reload app', description: 'CSS injection failed. Reloading the app should resolve it.', type: 'command', command: 'reload' }]
    case 'disk_read_failed':
      return [
        { label: 'Check file permissions', description: 'Construct could not read the space files. Verify file system permissions.', type: 'info' },
        { label: 'Re-install space', description: 'Re-installing may restore the missing or corrupted files.', route: '/app/marketplace', type: 'navigate' },
      ]
    case 'disabled':
      return [{ label: 'Enable in Settings', description: 'This space is currently disabled. Enable it in Space settings.', route: '/app/settings/spaces', type: 'navigate' }]
    case 'unknown':
    default:
      return [
        { label: 'Browse Marketplace', description: 'Try re-installing the space from the marketplace.', route: '/app/marketplace', type: 'navigate' },
        { label: 'Check Settings', description: 'Review your space configuration in Settings.', route: '/app/settings/spaces', type: 'navigate' },
      ]
  }
}

/**
 * Detect the error phase from an error message string.
 * Used to classify unstructured errors from SpaceLoader into phases.
 */
export function detectErrorPhase(errorMessage: string): SpaceLoadErrorPhase {
  const msg = errorMessage.toLowerCase()

  if (msg.includes('checksum') || msg.includes('integrity')) return 'checksum_mismatch'
  if (msg.includes('version') || msg.includes('incompatible') || msg.includes('hostapiversion')) return 'version_incompatible'
  if (msg.includes('bundle') && (msg.includes('missing') || msg.includes('not found'))) return 'missing_bundle'
  if (msg.includes('manifest') && (msg.includes('missing') || msg.includes('not found'))) return 'missing_manifest'
  if (msg.includes('agent') && (msg.includes('config') || msg.includes('missing'))) return 'agent_config_missing'
  if (msg.includes('eval') || msg.includes('execute') || msg.includes('syntax')) return 'eval_failed'
  if (msg.includes('pages') && msg.includes('export')) return 'no_pages_exported'
  if (msg.includes('css')) return 'css_injection_failed'
  if (msg.includes('permission') || msg.includes('eacces') || (msg.includes('file') && msg.includes('read'))) return 'disk_read_failed'
  if (msg.includes('disabled')) return 'disabled'

  return 'unknown'
}
