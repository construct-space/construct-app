/**
 * Space Validation Utilities
 *
 * Pure functions for manifest validation, version compatibility checking,
 * bundle import scanning, and the space doctor health report.
 *
 * Extracted from SpaceLoader.ts so these can be tested without importing
 * Vue components (coreSpaces.ts pulls in .vue files).
 */

import { HOST_API_VERSION, HOST_PROVIDED_PACKAGES } from '@/lib/spaceHostConstants'

// ---------------------------------------------------------------------------
// Manifest Validation (Slice C.2)
// ---------------------------------------------------------------------------

/** Structured validation result — errors block loading, warnings are advisory */
export interface ManifestValidationResult {
  valid: boolean
  errors: string[]
  warnings: string[]
}

/**
 * Validate a dynamic space manifest before loading the IIFE bundle.
 *
 * Required fields: id, name, version, pages (non-empty array).
 * Optional but validated when present: scope, navigation, widgets, agent, build.
 */
export function validateSpaceManifest(manifest: Record<string, unknown>): ManifestValidationResult {
  const errors: string[] = []
  const warnings: string[] = []

  // Required string fields
  if (typeof manifest.id !== 'string' || !manifest.id) {
    errors.push('Missing or invalid "id" (must be a non-empty string)')
  }
  if (typeof manifest.name !== 'string' || !manifest.name) {
    errors.push('Missing or invalid "name" (must be a non-empty string)')
  }
  if (typeof manifest.version !== 'string' || !manifest.version) {
    errors.push('Missing or invalid "version" (must be a non-empty string)')
  }

  // Pages — required, at least one entry
  const pages = manifest.pages as unknown[] | undefined
  if (!Array.isArray(pages) || pages.length === 0) {
    errors.push('Missing or empty "pages" array (at least one page required)')
  } else {
    for (let i = 0; i < pages.length; i++) {
      const p = pages[i] as Record<string, unknown>
      if (typeof p.path !== 'string') {
        errors.push(`pages[${i}]: missing "path" string`)
      }
      if (typeof p.label !== 'string') {
        errors.push(`pages[${i}]: missing "label" string`)
      }
    }
  }

  // Optional: scope
  if (manifest.scope !== undefined) {
    const validScopes = ['app', 'project', 'both']
    if (typeof manifest.scope !== 'string' || !validScopes.includes(manifest.scope)) {
      warnings.push(`Invalid "scope" value (expected one of: ${validScopes.join(', ')})`)
    }
  }

  // Optional: navigation
  if (manifest.navigation !== undefined) {
    const nav = manifest.navigation as Record<string, unknown>
    if (typeof nav !== 'object' || nav === null) {
      warnings.push('"navigation" should be an object')
    } else {
      if (typeof nav.label !== 'string') warnings.push('navigation.label should be a string')
      if (typeof nav.icon !== 'string') warnings.push('navigation.icon should be a string')
      if (typeof nav.to !== 'string') warnings.push('navigation.to should be a string')
      if (typeof nav.order !== 'number') warnings.push('navigation.order should be a number')
    }
  }

  // Optional: widgets
  if (manifest.widgets !== undefined) {
    if (!Array.isArray(manifest.widgets)) {
      warnings.push('"widgets" should be an array')
    }
  }

  // Optional: agent
  if (manifest.agent !== undefined) {
    if (typeof manifest.agent !== 'string') {
      warnings.push('"agent" should be a string path')
    }
  }

  // Optional: build
  if (manifest.build !== undefined) {
    const build = manifest.build as Record<string, unknown>
    if (typeof build !== 'object' || build === null) {
      warnings.push('"build" should be an object')
    } else {
      if (build.checksum !== undefined && typeof build.checksum !== 'string') {
        warnings.push('build.checksum should be a string')
      }
      if (build.hostApiVersion !== undefined && typeof build.hostApiVersion !== 'string') {
        warnings.push('build.hostApiVersion should be a string')
      }
    }
  }

  return { valid: errors.length === 0, errors, warnings }
}

// ---------------------------------------------------------------------------
// Version Compatibility (Slice B.4)
// ---------------------------------------------------------------------------

/** Parse a semver string into [major, minor, patch]. Returns null if invalid. */
export function parseSemver(version: string): [number, number, number] | null {
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)/)
  if (!match) return null
  return [parseInt(match[1], 10), parseInt(match[2], 10), parseInt(match[3], 10)]
}

export type VersionCompatibility = 'compatible' | 'minor-mismatch' | 'incompatible' | 'unknown'

/**
 * Check if a space's recorded hostApiVersion is compatible with the current host.
 *
 * - Major mismatch → 'incompatible' (block)
 * - Minor mismatch → 'minor-mismatch' (warn)
 * - Otherwise → 'compatible'
 * - Missing/unparseable → 'unknown'
 */
export function checkVersionCompatibility(spaceHostApiVersion: string | undefined): VersionCompatibility {
  if (!spaceHostApiVersion) return 'unknown'

  const spaceSemver = parseSemver(spaceHostApiVersion)
  const hostSemver = parseSemver(HOST_API_VERSION)

  if (!spaceSemver || !hostSemver) return 'unknown'

  if (spaceSemver[0] !== hostSemver[0]) return 'incompatible'
  if (spaceSemver[1] !== hostSemver[1]) return 'minor-mismatch'
  return 'compatible'
}

// ---------------------------------------------------------------------------
// Bundle Import Scanning (Slice C.1)
// ---------------------------------------------------------------------------

/**
 * Best-effort scan of an IIFE bundle string for references to packages
 * that are not in HOST_PROVIDED_PACKAGES. This catches common cases where
 * a space tries to import a package that the host doesn't provide and
 * that wasn't bundled locally.
 *
 * Returns an array of suspicious package references found.
 */
export function scanBundleForUnsupportedImports(bundleContent: string): string[] {
  const suspicious: string[] = []

  // Look for window.__CONSTRUCT__["pkg"] or window.__CONSTRUCT__['pkg'] patterns
  // These are generated by rollup externalization
  const regex = /window\.__CONSTRUCT__\[["']([^"']+)["']\]/g
  let match: RegExpExecArray | null
  while ((match = regex.exec(bundleContent)) !== null) {
    const pkg = match[1]
    if (!HOST_PROVIDED_PACKAGES.includes(pkg)) {
      suspicious.push(pkg)
    }
  }

  // Deduplicate
  return [...new Set(suspicious)]
}

// ---------------------------------------------------------------------------
// Space Doctor Types (Slice D.3)
// ---------------------------------------------------------------------------

/** Health check result for a single space */
export interface SpaceHealthCheck {
  spaceId: string
  manifestValid: boolean
  manifestErrors: string[]
  manifestWarnings: string[]
  checksumMatch: boolean | null // null = no checksum in manifest
  versionCompatibility: VersionCompatibility
  agentAssetsValid: boolean
  agentAssetWarnings: string[]
}

/** Aggregated health report for all installed spaces */
export interface SpaceDoctorReport {
  timestamp: number
  spaces: SpaceHealthCheck[]
  summary: {
    total: number
    healthy: number
    warnings: number
    errors: number
  }
}

/**
 * Build a doctor report summary from individual space health checks.
 */
export function buildDoctorReport(spaces: SpaceHealthCheck[]): SpaceDoctorReport {
  let healthy = 0
  let warnings = 0
  let errors = 0

  for (const s of spaces) {
    const hasErrors = s.manifestErrors.length > 0 || s.checksumMatch === false || s.versionCompatibility === 'incompatible'
    const hasWarnings = s.manifestWarnings.length > 0 || s.agentAssetWarnings.length > 0 || s.versionCompatibility === 'minor-mismatch'

    if (hasErrors) errors++
    else if (hasWarnings) warnings++
    else healthy++
  }

  return {
    timestamp: Date.now(),
    spaces,
    summary: { total: spaces.length, healthy, warnings, errors },
  }
}

/** Structured error returned when space loading fails. */
export interface SpaceLoadError {
  spaceId: string
  phase: 'manifest' | 'validation' | 'version' | 'checksum' | 'bundle' | 'eval' | 'export'
  message: string
  details?: string[]
}
