/**
 * Tests for 0.8.0 Slices B, C, D — host contract, runtime validation, error boundaries.
 *
 * Covers:
 * - validateSpaceManifest() — valid/invalid manifests (Slice C.2)
 * - parseSemver() + checkVersionCompatibility() — version checks (Slice B.4)
 * - scanBundleForUnsupportedImports() — bundle scanning (Slice C.1)
 * - spaceDoctor() health checks (Slice D.3)
 * - Space unload cleanup (Slice D.2)
 * - HOST_PROVIDED_PACKAGES correctness (Slice B.1)
 * - Error boundary logic (Slice D.1)
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import {
  validateSpaceManifest,
  parseSemver,
  checkVersionCompatibility,
  scanBundleForUnsupportedImports,
  buildDoctorReport,
  type ManifestValidationResult,
  type VersionCompatibility,
  type SpaceHealthCheck,
} from '../validation'
import { HOST_API_VERSION, HOST_PROVIDED_PACKAGES } from '../../lib/spaceHostConstants'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal valid manifest for dynamic spaces */
function validManifest(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'test-space',
    name: 'Test Space',
    version: '1.0.0',
    description: 'A test space',
    icon: 'lucide:test',
    scope: 'app',
    navigation: { label: 'Test', icon: 'lucide:test', to: 'test', order: 1 },
    pages: [{ path: '', label: 'Home', default: true }],
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Slice B.1 — HOST_PROVIDED_PACKAGES
// ---------------------------------------------------------------------------

describe('HOST_PROVIDED_PACKAGES', () => {
  it('is a non-empty readonly array', () => {
    expect(Array.isArray(HOST_PROVIDED_PACKAGES)).toBe(true)
    expect(HOST_PROVIDED_PACKAGES.length).toBeGreaterThan(0)
  })

  it('includes core framework packages', () => {
    expect(HOST_PROVIDED_PACKAGES).toContain('vue')
    expect(HOST_PROVIDED_PACKAGES).toContain('vue-router')
    expect(HOST_PROVIDED_PACKAGES).toContain('pinia')
  })

  it('includes vueuse packages', () => {
    expect(HOST_PROVIDED_PACKAGES).toContain('@vueuse/core')
    expect(HOST_PROVIDED_PACKAGES).toContain('@vueuse/integrations')
  })

  it('includes tauri packages', () => {
    expect(HOST_PROVIDED_PACKAGES).toContain('@tauri-apps/api')
    expect(HOST_PROVIDED_PACKAGES).toContain('@tauri-apps/api/core')
    expect(HOST_PROVIDED_PACKAGES).toContain('@tauri-apps/plugin-fs')
    expect(HOST_PROVIDED_PACKAGES).toContain('@tauri-apps/plugin-shell')
  })

  it('includes utility packages', () => {
    expect(HOST_PROVIDED_PACKAGES).toContain('lucide-vue-next')
    expect(HOST_PROVIDED_PACKAGES).toContain('date-fns')
    expect(HOST_PROVIDED_PACKAGES).toContain('dexie')
    expect(HOST_PROVIDED_PACKAGES).toContain('zod')
  })

  it('includes construct packages', () => {
    expect(HOST_PROVIDED_PACKAGES).toContain('@construct-space/ui')
    expect(HOST_PROVIDED_PACKAGES).toContain('@construct/sdk')
    expect(HOST_PROVIDED_PACKAGES).toContain('@construct-space/sdk') // backward compat
  })

  it('does not include packages that should be bundled locally', () => {
    expect(HOST_PROVIDED_PACKAGES).not.toContain('lodash')
    expect(HOST_PROVIDED_PACKAGES).not.toContain('axios')
    expect(HOST_PROVIDED_PACKAGES).not.toContain('react')
  })
})

// ---------------------------------------------------------------------------
// Slice B.4 — HOST_API_VERSION + version compatibility
// ---------------------------------------------------------------------------

describe('HOST_API_VERSION', () => {
  it('is a valid semver string', () => {
    expect(HOST_API_VERSION).toMatch(/^\d+\.\d+\.\d+$/)
  })
})

describe('parseSemver', () => {
  it('parses valid semver strings', () => {
    expect(parseSemver('0.2.0')).toEqual([0, 2, 0])
    expect(parseSemver('1.0.0')).toEqual([1, 0, 0])
    expect(parseSemver('2.3.4')).toEqual([2, 3, 4])
    expect(parseSemver('10.20.30')).toEqual([10, 20, 30])
  })

  it('parses semver with trailing content (pre-release, metadata)', () => {
    expect(parseSemver('1.2.3-beta')).toEqual([1, 2, 3])
    expect(parseSemver('1.2.3+build')).toEqual([1, 2, 3])
  })

  it('returns null for invalid strings', () => {
    expect(parseSemver('')).toBeNull()
    expect(parseSemver('abc')).toBeNull()
    expect(parseSemver('1.2')).toBeNull()
    expect(parseSemver('v1.0.0')).toBeNull() // no 'v' prefix support
  })
})

describe('checkVersionCompatibility', () => {
  it('returns "unknown" for undefined/empty version', () => {
    expect(checkVersionCompatibility(undefined)).toBe('unknown')
    expect(checkVersionCompatibility('')).toBe('unknown')
  })

  it('returns "unknown" for unparseable version', () => {
    expect(checkVersionCompatibility('abc')).toBe('unknown')
    expect(checkVersionCompatibility('not-a-version')).toBe('unknown')
  })

  it('returns "compatible" when versions match exactly', () => {
    expect(checkVersionCompatibility(HOST_API_VERSION)).toBe('compatible')
  })

  it('returns "compatible" when major and minor match', () => {
    // Same major and minor as HOST_API_VERSION (0.2.x), different patch
    const hostSemver = parseSemver(HOST_API_VERSION)!
    const sameMinor = `${hostSemver[0]}.${hostSemver[1]}.99`
    expect(checkVersionCompatibility(sameMinor)).toBe('compatible')
  })

  it('returns "minor-mismatch" when major matches but minor differs', () => {
    const hostSemver = parseSemver(HOST_API_VERSION)!
    const differentMinor = `${hostSemver[0]}.${hostSemver[1] + 1}.0`
    expect(checkVersionCompatibility(differentMinor)).toBe('minor-mismatch')
  })

  it('returns "incompatible" when major version differs', () => {
    const hostSemver = parseSemver(HOST_API_VERSION)!
    const differentMajor = `${hostSemver[0] + 1}.0.0`
    expect(checkVersionCompatibility(differentMajor)).toBe('incompatible')
  })
})

// ---------------------------------------------------------------------------
// Slice C.1 — Bundle import scanning
// ---------------------------------------------------------------------------

describe('scanBundleForUnsupportedImports', () => {
  it('returns empty array for bundle with only host-provided packages', () => {
    const bundle = `
      var Vue = window.__CONSTRUCT__["vue"];
      var Pinia = window.__CONSTRUCT__["pinia"];
      var Zod = window.__CONSTRUCT__["zod"];
    `
    expect(scanBundleForUnsupportedImports(bundle)).toEqual([])
  })

  it('detects references to non-host packages', () => {
    const bundle = `
      var Vue = window.__CONSTRUCT__["vue"];
      var Lodash = window.__CONSTRUCT__["lodash"];
      var Axios = window.__CONSTRUCT__["axios"];
    `
    const result = scanBundleForUnsupportedImports(bundle)
    expect(result).toContain('lodash')
    expect(result).toContain('axios')
    expect(result).not.toContain('vue')
  })

  it('handles single-quoted keys', () => {
    const bundle = `var X = window.__CONSTRUCT__['unknown-pkg'];`
    const result = scanBundleForUnsupportedImports(bundle)
    expect(result).toContain('unknown-pkg')
  })

  it('deduplicates repeated references', () => {
    const bundle = `
      var A = window.__CONSTRUCT__["lodash"];
      var B = window.__CONSTRUCT__["lodash"];
      var C = window.__CONSTRUCT__["lodash"];
    `
    const result = scanBundleForUnsupportedImports(bundle)
    expect(result).toEqual(['lodash'])
  })

  it('returns empty array for empty bundle', () => {
    expect(scanBundleForUnsupportedImports('')).toEqual([])
  })

  it('returns empty array for bundle with no __CONSTRUCT__ references', () => {
    const bundle = `(function() { console.log("hello"); })();`
    expect(scanBundleForUnsupportedImports(bundle)).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Slice C.2 — Manifest validation
// ---------------------------------------------------------------------------

describe('validateSpaceManifest', () => {
  it('returns valid for a complete manifest', () => {
    const result = validateSpaceManifest(validManifest())
    expect(result.valid).toBe(true)
    expect(result.errors).toEqual([])
  })

  it('reports missing id', () => {
    const result = validateSpaceManifest(validManifest({ id: undefined }))
    expect(result.valid).toBe(false)
    expect(result.errors.some(e => e.includes('id'))).toBe(true)
  })

  it('reports empty id', () => {
    const result = validateSpaceManifest(validManifest({ id: '' }))
    expect(result.valid).toBe(false)
    expect(result.errors.some(e => e.includes('id'))).toBe(true)
  })

  it('reports missing name', () => {
    const result = validateSpaceManifest(validManifest({ name: undefined }))
    expect(result.valid).toBe(false)
    expect(result.errors.some(e => e.includes('name'))).toBe(true)
  })

  it('reports missing version', () => {
    const result = validateSpaceManifest(validManifest({ version: undefined }))
    expect(result.valid).toBe(false)
    expect(result.errors.some(e => e.includes('version'))).toBe(true)
  })

  it('reports missing pages', () => {
    const result = validateSpaceManifest(validManifest({ pages: undefined }))
    expect(result.valid).toBe(false)
    expect(result.errors.some(e => e.includes('pages'))).toBe(true)
  })

  it('reports empty pages array', () => {
    const result = validateSpaceManifest(validManifest({ pages: [] }))
    expect(result.valid).toBe(false)
    expect(result.errors.some(e => e.includes('pages'))).toBe(true)
  })

  it('reports page without path', () => {
    const result = validateSpaceManifest(validManifest({ pages: [{ label: 'Home' }] }))
    expect(result.valid).toBe(false)
    expect(result.errors.some(e => e.includes('path'))).toBe(true)
  })

  it('reports page without label', () => {
    const result = validateSpaceManifest(validManifest({ pages: [{ path: '' }] }))
    expect(result.valid).toBe(false)
    expect(result.errors.some(e => e.includes('label'))).toBe(true)
  })

  it('reports all missing fields on empty object', () => {
    const result = validateSpaceManifest({})
    expect(result.valid).toBe(false)
    expect(result.errors.length).toBeGreaterThanOrEqual(4) // id, name, version, pages
    expect(result.errors.some(e => e.includes('id'))).toBe(true)
    expect(result.errors.some(e => e.includes('name'))).toBe(true)
    expect(result.errors.some(e => e.includes('version'))).toBe(true)
    expect(result.errors.some(e => e.includes('pages'))).toBe(true)
  })

  // Warnings for optional fields
  it('warns on invalid scope value', () => {
    const result = validateSpaceManifest(validManifest({ scope: 'invalid' }))
    expect(result.valid).toBe(true) // scope is optional — warning not error
    expect(result.warnings.some(w => w.includes('scope'))).toBe(true)
  })

  it('warns on invalid navigation object', () => {
    const result = validateSpaceManifest(validManifest({ navigation: 'not-an-object' }))
    expect(result.valid).toBe(true) // navigation is optional
    expect(result.warnings.some(w => w.includes('navigation'))).toBe(true)
  })

  it('warns on navigation with missing sub-fields', () => {
    const result = validateSpaceManifest(validManifest({ navigation: { label: 123 } }))
    expect(result.warnings.some(w => w.includes('navigation.label'))).toBe(true)
  })

  it('warns on non-array widgets', () => {
    const result = validateSpaceManifest(validManifest({ widgets: 'not-array' }))
    expect(result.warnings.some(w => w.includes('widgets'))).toBe(true)
  })

  it('warns on non-string agent', () => {
    const result = validateSpaceManifest(validManifest({ agent: 123 }))
    expect(result.warnings.some(w => w.includes('agent'))).toBe(true)
  })

  it('warns on invalid build object', () => {
    const result = validateSpaceManifest(validManifest({ build: 'not-an-object' }))
    expect(result.warnings.some(w => w.includes('build'))).toBe(true)
  })

  it('warns on invalid build.checksum type', () => {
    const result = validateSpaceManifest(validManifest({ build: { checksum: 123 } }))
    expect(result.warnings.some(w => w.includes('build.checksum'))).toBe(true)
  })

  it('returns no warnings for valid optional fields', () => {
    const result = validateSpaceManifest(validManifest({
      scope: 'project',
      widgets: [{ id: 'w1', name: 'Widget' }],
      agent: 'agent/config.md',
      build: { checksum: 'abc123', hostApiVersion: '0.2.0' },
    }))
    expect(result.valid).toBe(true)
    expect(result.warnings).toEqual([])
  })

  it('validates a minimal valid manifest (only required fields)', () => {
    const result = validateSpaceManifest({
      id: 'x',
      name: 'X',
      version: '0.1.0',
      pages: [{ path: '', label: 'Home' }],
    })
    expect(result.valid).toBe(true)
    expect(result.errors).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Slice D.1 — Error boundary (SpaceLoadError type shape)
// ---------------------------------------------------------------------------

describe('SpaceLoadError type shape', () => {
  it('can construct a valid SpaceLoadError object', () => {
    const err = {
      spaceId: 'test',
      phase: 'manifest' as const,
      message: 'Failed to parse',
      details: ['JSON parse error'],
    }
    expect(err.spaceId).toBe('test')
    expect(err.phase).toBe('manifest')
    expect(err.details).toHaveLength(1)
  })

  it('all phase values are valid', () => {
    const phases = ['manifest', 'validation', 'version', 'checksum', 'bundle', 'eval', 'export'] as const
    for (const phase of phases) {
      const err = { spaceId: 'x', phase, message: 'test' }
      expect(err.phase).toBe(phase)
    }
  })
})

// ---------------------------------------------------------------------------
// Slice D.3 — spaceDoctor / buildDoctorReport
// ---------------------------------------------------------------------------

describe('buildDoctorReport', () => {
  it('returns correct summary for empty spaces list', () => {
    const report = buildDoctorReport([])
    expect(report.summary).toEqual({ total: 0, healthy: 0, warnings: 0, errors: 0 })
    expect(report.spaces).toEqual([])
    expect(report.timestamp).toBeGreaterThan(0)
  })

  it('counts healthy spaces correctly', () => {
    const spaces: SpaceHealthCheck[] = [
      {
        spaceId: 'good-space',
        manifestValid: true,
        manifestErrors: [],
        manifestWarnings: [],
        checksumMatch: true,
        versionCompatibility: 'compatible',
        agentAssetsValid: true,
        agentAssetWarnings: [],
      },
    ]
    const report = buildDoctorReport(spaces)
    expect(report.summary).toEqual({ total: 1, healthy: 1, warnings: 0, errors: 0 })
  })

  it('counts errored spaces — manifest errors', () => {
    const spaces: SpaceHealthCheck[] = [
      {
        spaceId: 'bad-manifest',
        manifestValid: false,
        manifestErrors: ['Missing id'],
        manifestWarnings: [],
        checksumMatch: null,
        versionCompatibility: 'unknown',
        agentAssetsValid: true,
        agentAssetWarnings: [],
      },
    ]
    const report = buildDoctorReport(spaces)
    expect(report.summary.errors).toBe(1)
    expect(report.summary.healthy).toBe(0)
  })

  it('counts errored spaces — checksum mismatch', () => {
    const spaces: SpaceHealthCheck[] = [
      {
        spaceId: 'bad-checksum',
        manifestValid: true,
        manifestErrors: [],
        manifestWarnings: [],
        checksumMatch: false,
        versionCompatibility: 'compatible',
        agentAssetsValid: true,
        agentAssetWarnings: [],
      },
    ]
    const report = buildDoctorReport(spaces)
    expect(report.summary.errors).toBe(1)
  })

  it('counts errored spaces — incompatible version', () => {
    const spaces: SpaceHealthCheck[] = [
      {
        spaceId: 'bad-version',
        manifestValid: true,
        manifestErrors: [],
        manifestWarnings: [],
        checksumMatch: true,
        versionCompatibility: 'incompatible',
        agentAssetsValid: true,
        agentAssetWarnings: [],
      },
    ]
    const report = buildDoctorReport(spaces)
    expect(report.summary.errors).toBe(1)
  })

  it('counts warning spaces — minor version mismatch', () => {
    const spaces: SpaceHealthCheck[] = [
      {
        spaceId: 'minor-mismatch',
        manifestValid: true,
        manifestErrors: [],
        manifestWarnings: [],
        checksumMatch: true,
        versionCompatibility: 'minor-mismatch',
        agentAssetsValid: true,
        agentAssetWarnings: [],
      },
    ]
    const report = buildDoctorReport(spaces)
    expect(report.summary.warnings).toBe(1)
    expect(report.summary.healthy).toBe(0)
  })

  it('counts warning spaces — agent asset warnings', () => {
    const spaces: SpaceHealthCheck[] = [
      {
        spaceId: 'missing-agent',
        manifestValid: true,
        manifestErrors: [],
        manifestWarnings: [],
        checksumMatch: true,
        versionCompatibility: 'compatible',
        agentAssetsValid: false,
        agentAssetWarnings: ['Agent config not found: agent/config.md'],
      },
    ]
    const report = buildDoctorReport(spaces)
    expect(report.summary.warnings).toBe(1)
  })

  it('counts warning spaces — manifest warnings', () => {
    const spaces: SpaceHealthCheck[] = [
      {
        spaceId: 'manifest-warns',
        manifestValid: true,
        manifestErrors: [],
        manifestWarnings: ['Invalid scope value'],
        checksumMatch: true,
        versionCompatibility: 'compatible',
        agentAssetsValid: true,
        agentAssetWarnings: [],
      },
    ]
    const report = buildDoctorReport(spaces)
    expect(report.summary.warnings).toBe(1)
  })

  it('handles mixed healthy, warning, and error spaces', () => {
    const spaces: SpaceHealthCheck[] = [
      {
        spaceId: 'healthy',
        manifestValid: true,
        manifestErrors: [],
        manifestWarnings: [],
        checksumMatch: true,
        versionCompatibility: 'compatible',
        agentAssetsValid: true,
        agentAssetWarnings: [],
      },
      {
        spaceId: 'warning',
        manifestValid: true,
        manifestErrors: [],
        manifestWarnings: ['Some warning'],
        checksumMatch: true,
        versionCompatibility: 'compatible',
        agentAssetsValid: true,
        agentAssetWarnings: [],
      },
      {
        spaceId: 'error',
        manifestValid: false,
        manifestErrors: ['Missing id'],
        manifestWarnings: [],
        checksumMatch: null,
        versionCompatibility: 'unknown',
        agentAssetsValid: true,
        agentAssetWarnings: [],
      },
    ]
    const report = buildDoctorReport(spaces)
    expect(report.summary).toEqual({ total: 3, healthy: 1, warnings: 1, errors: 1 })
  })

  it('errors take priority over warnings in classification', () => {
    // A space with both errors and warnings should be counted as error, not warning
    const spaces: SpaceHealthCheck[] = [
      {
        spaceId: 'both',
        manifestValid: false,
        manifestErrors: ['Missing id'],
        manifestWarnings: ['Bad scope'],
        checksumMatch: false,
        versionCompatibility: 'incompatible',
        agentAssetsValid: false,
        agentAssetWarnings: ['Missing agent'],
      },
    ]
    const report = buildDoctorReport(spaces)
    expect(report.summary.errors).toBe(1)
    expect(report.summary.warnings).toBe(0)
    expect(report.summary.healthy).toBe(0)
  })
})

describe('spaceDoctor helper functions (integration)', () => {
  it('validateSpaceManifest correctly identifies broken manifests', () => {
    const broken = validateSpaceManifest({})
    expect(broken.valid).toBe(false)
    expect(broken.errors.length).toBeGreaterThan(0)
  })

  it('checkVersionCompatibility works for all scenarios used by doctor', () => {
    const hostSemver = parseSemver(HOST_API_VERSION)!
    expect(checkVersionCompatibility(HOST_API_VERSION)).toBe('compatible')

    const minor = `${hostSemver[0]}.${hostSemver[1] + 1}.0`
    expect(checkVersionCompatibility(minor)).toBe('minor-mismatch')

    const major = `${hostSemver[0] + 1}.0.0`
    expect(checkVersionCompatibility(major)).toBe('incompatible')

    expect(checkVersionCompatibility(undefined)).toBe('unknown')
  })

  it('scanBundleForUnsupportedImports identifies issues used by doctor', () => {
    const clean = scanBundleForUnsupportedImports(`window.__CONSTRUCT__["vue"]`)
    expect(clean).toEqual([])

    const dirty = scanBundleForUnsupportedImports(`window.__CONSTRUCT__["react"]`)
    expect(dirty).toContain('react')
  })
})
