/**
 * Space Host Constants
 *
 * Pure data constants for the host contract — no runtime imports.
 * These are the canonical source of truth for:
 *   - Which packages the host externalizes
 *   - The host API version for compatibility checking
 *
 * Separated from spaceHost.ts so that validation code and tests can
 * import these without pulling in Vue, Pinia, Tauri, etc.
 */

/**
 * The current host API version.
 *
 * Space manifests record `build.hostApiVersion` at build time.
 * At load time, SpaceLoader compares the space's recorded version
 * against this constant:
 *   - Major mismatch → block (incompatible ABI)
 *   - Minor mismatch → warn (may lack newer host features)
 *   - Patch mismatch → silent (bug-fix level, always compatible)
 *
 * Bump major when removing/renaming host-provided packages.
 * Bump minor when adding new host-provided packages.
 * Bump patch for bug fixes in the host provider.
 */
export const HOST_API_VERSION = '0.6.0'

/**
 * Canonical list of package IDs that the host externalizes via window.__CONSTRUCT__.
 *
 * These packages are provided at runtime by the host app and must NOT be
 * bundled inside a space's IIFE. The space build tool (construct CLI) uses
 * this list to configure rollup externals.
 *
 * Any package NOT in this list must be bundled locally inside the space's
 * IIFE bundle. If a space imports a package that is neither host-provided
 * nor bundled, it will fail at runtime with a missing module error.
 */
export const HOST_PROVIDED_PACKAGES: readonly string[] = [
  'vue',
  'vue-router',
  'pinia',
  '@vueuse/core',
  '@vueuse/integrations',
  'lucide-vue-next',
  'date-fns',
  'dexie',
  'zod',
  '@construct-space/ui',
  '@construct-space/sdk',
] as const

/**
 * The externalization IDs — keys used in window.__CONSTRUCT__.
 * This type can be used to enforce that only known keys are accessed.
 */
export type HostExternalizationId = typeof HOST_PROVIDED_PACKAGES[number]
