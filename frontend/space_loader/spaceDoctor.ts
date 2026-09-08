/**
 * Space Doctor — Health checks for installed spaces.
 *
 * Scans all installed spaces and reports their health status.
 * Checks:
 *   - manifest.json exists and is valid JSON
 *   - IIFE bundle file exists
 *   - style.css exists
 *   - Checksum matches (if build.checksum present in manifest)
 *   - Host API version compatibility (if build.hostApiVersion present)
 *   - Space is enabled in marketplace settings
 */

import { getSpaceIdFromDirName, getSpacesDirPath } from '@/lib/appPaths'
import { getCoreSpaceManifests } from './coreSpaces'
import type { SpaceManifest } from './SpaceLoader'
import type { SpaceLoadErrorPhase } from './errorActions'
import { HOST_API_VERSION } from '@/lib/spaceHostConstants'
import { isSpaceBundleEntry } from './spaceBundleResolver'
import { createSpaceSource, resolveJsEntry } from './SpaceSource'

export type SpaceHealthStatus = 'healthy' | 'warning' | 'error'

export interface SpaceHealthReport {
  spaceId: string
  name: string
  version: string
  status: SpaceHealthStatus
  issues: SpaceHealthIssue[]
  isCore: boolean
}

export interface SpaceHealthIssue {
  phase: SpaceLoadErrorPhase
  message: string
  severity: 'warning' | 'error'
}

// HOST_API_VERSION imported from spaceHostConstants.ts (canonical source)

/**
 * Run health checks on all installed spaces.
 * Returns a report per space with health status and any issues found.
 */
export async function spaceDoctor(): Promise<SpaceHealthReport[]> {
  const reports: SpaceHealthReport[] = []

  // Core spaces are always healthy (compiled into the app)
  const coreManifests = getCoreSpaceManifests()
  for (const manifest of coreManifests) {
    reports.push({
      spaceId: manifest.id,
      name: manifest.name,
      version: manifest.version,
      status: 'healthy',
      issues: [],
      isCore: true,
    })
  }

  // Check disk-installed spaces
  try {
    const { readDir, exists } = await import('@tauri-apps/plugin-fs')
    const { homeDir } = await import('@tauri-apps/api/path')

    const home = await homeDir()
    const spacesDir = getSpacesDirPath(home)

    if (!(await exists(spacesDir))) {
      return reports
    }

    const coreIds = new Set(coreManifests.map(m => m.id))
    const disabledIds = getDisabledSpaceIds()
    const entries = await readDir(spacesDir)

    for (const entry of entries) {
      if (!isSpaceBundleEntry(entry)) continue
      const spaceId = getSpaceIdFromDirName(entry.name)
      if (!spaceId) continue
      if (coreIds.has(spaceId)) continue

      const issues: SpaceHealthIssue[] = []
      let name = spaceId
      let version = '0.0.0'

      const src = await createSpaceSource(spaceId)
      if (!src) {
        reports.push({
          spaceId,
          name,
          version,
          status: 'error',
          issues: [{ phase: 'missing_manifest', message: 'Bundle could not be resolved', severity: 'error' }],
          isCore: false,
        })
        continue
      }

      // Check manifest
      let manifest: SpaceManifest | null = null
      if (!(await src.entryExists('manifest.json'))) {
        issues.push({
          phase: 'missing_manifest',
          message: 'manifest.json not found',
          severity: 'error',
        })
      } else {
        try {
          manifest = JSON.parse(await src.readText('manifest.json')) as SpaceManifest
          name = manifest.name || spaceId
          version = manifest.version || '0.0.0'
        } catch {
          issues.push({
            phase: 'missing_manifest',
            message: 'manifest.json is invalid JSON',
            severity: 'error',
          })
        }
      }

      // Check JS bundle (resolved by listing — app.iife.js or space-<id>.iife.js)
      const jsEntry = await resolveJsEntry(src)
      if (!jsEntry) {
        issues.push({
          phase: 'missing_bundle',
          message: 'No JS bundle (*.iife.js) found',
          severity: 'error',
        })
      } else if (manifest?.build?.checksum) {
        // Verify checksum
        try {
          const actual = await sha256Hex(await src.readText(jsEntry))
          if (actual !== manifest.build.checksum) {
            issues.push({
              phase: 'checksum_mismatch',
              message: `Bundle checksum mismatch (expected ${manifest.build.checksum.slice(0, 8)}..., got ${actual.slice(0, 8)}...)`,
              severity: 'error',
            })
          }
        } catch {
          issues.push({
            phase: 'disk_read_failed',
            message: 'Could not read bundle file for checksum verification',
            severity: 'warning',
          })
        }
      }
      // CSS is optional — newer bundles inline it, so a missing style.css is
      // no longer an error.

      // Check host API version compatibility
      if (manifest?.build?.hostApiVersion) {
        if (!isCompatibleVersion(manifest.build.hostApiVersion, HOST_API_VERSION)) {
          issues.push({
            phase: 'version_incompatible',
            message: `Space requires host API v${manifest.build.hostApiVersion}, current is v${HOST_API_VERSION}`,
            severity: 'warning',
          })
        }
      }

      // Check if disabled
      if (disabledIds.has(spaceId)) {
        issues.push({
          phase: 'disabled',
          message: 'Space is disabled in settings',
          severity: 'warning',
        })
      }

      // Check agent config if manifest declares an agent
      if (manifest?.agent) {
        if (!(await src.entryExists(manifest.agent))) {
          issues.push({
            phase: 'agent_config_missing',
            message: `Agent config not found: ${manifest.agent}`,
            severity: 'warning',
          })
        }
      }

      // Determine overall status
      let status: SpaceHealthStatus = 'healthy'
      if (issues.some(i => i.severity === 'error')) {
        status = 'error'
      } else if (issues.length > 0) {
        status = 'warning'
      }

      reports.push({
        spaceId,
        name,
        version,
        status,
        issues,
        isCore: false,
      })
    }
  } catch (err) {
    console.error('[spaceDoctor] Health check failed:', err)
  }

  return reports
}

/** Read disabled space IDs from marketplace localStorage state */
function getDisabledSpaceIds(): Set<string> {
  try {
    const raw = localStorage.getItem('construct:installed_spaces')
    if (!raw) return new Set()
    const items = JSON.parse(raw) as { id: string; enabled: boolean }[]
    return new Set(items.filter(s => s.enabled === false).map(s => s.id))
  } catch {
    return new Set()
  }
}

/** Compute SHA-256 hex digest of a string */
async function sha256Hex(content: string): Promise<string> {
  const data = new TextEncoder().encode(content)
  const hash = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, '0')).join('')
}

/** Check if a required version is compatible with the current version (major must match) */
function isCompatibleVersion(required: string, current: string): boolean {
  const r = required.replace(/^v/, '').split('.').map(Number)
  const c = current.replace(/^v/, '').split('.').map(Number)
  // Major version must match; current minor/patch must be >= required
  if (r[0] !== c[0]) return false
  if ((c[1] || 0) < (r[1] || 0)) return false
  if ((c[1] || 0) === (r[1] || 0) && (c[2] || 0) < (r[2] || 0)) return false
  return true
}
