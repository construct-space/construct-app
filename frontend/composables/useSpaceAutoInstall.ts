/**
 * Auto-install disabled — spaces are installed manually from the marketplace.
 * Built-in spaces are host-native and don't need installation.
 */

export function useSpaceAutoInstall() {
  async function installMissing(_missingIds: string[]): Promise<void> {
    // No-op — auto-install is disabled
  }

  return { installMissing }
}
