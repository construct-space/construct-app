import { describe, expect, it } from 'vitest'
import {
  HOST_NATIVE_SPACE_IDS,
  isHostNativeSpace,
  validateHostNativeManifest,
} from '../../types/space'
import { BUILTIN_SPACE_IDS } from '../builtin'

import askManifest from '../../spaces/ask/manifest.json'
import orgManifest from '../../spaces/org/manifest.json'
import projectManifest from '../../spaces/project/manifest.json'
import orgProjectManifest from '../../spaces/org-project/manifest.json'
import builderManifest from '../../spaces/builder/manifest.json'
import spaceDeveloperManifest from '../../spaces/space-developer/manifest.json'

const ALL_MANIFESTS: Record<string, Record<string, unknown>> = {
  ask: askManifest as unknown as Record<string, unknown>,
  builder: builderManifest as unknown as Record<string, unknown>,
  org: orgManifest as unknown as Record<string, unknown>,
  'org-project': orgProjectManifest as unknown as Record<string, unknown>,
  project: projectManifest as unknown as Record<string, unknown>,
  'space-developer': spaceDeveloperManifest as unknown as Record<string, unknown>,
}

describe('space type discrimination', () => {
  it('identifies host-native space IDs', () => {
    expect(isHostNativeSpace('ask')).toBe(true)
    expect(isHostNativeSpace('org')).toBe(true)
    expect(isHostNativeSpace('project')).toBe(true)
    expect(isHostNativeSpace('org-project')).toBe(true)
  })

  it('rejects non-host-native space IDs', () => {
    expect(isHostNativeSpace('coder')).toBe(false)
    expect(isHostNativeSpace('architect')).toBe(false)
    expect(isHostNativeSpace('code')).toBe(false)
    expect(isHostNativeSpace('design')).toBe(false)
    expect(isHostNativeSpace('kanban')).toBe(false)
    expect(isHostNativeSpace('projects')).toBe(false) // common typo
    expect(isHostNativeSpace('')).toBe(false)
  })

  it('HOST_NATIVE_SPACE_IDS matches ALL_MANIFESTS', () => {
    expect(HOST_NATIVE_SPACE_IDS).toHaveLength(Object.keys(ALL_MANIFESTS).length)
  })

  it('HOST_NATIVE_SPACE_IDS contains the correct IDs', () => {
    const ids = [...HOST_NATIVE_SPACE_IDS].sort()
    expect(ids).toEqual(['ask', 'builder', 'org', 'org-project', 'project', 'space-developer'])
  })
})

describe('BUILTIN_SPACE_IDS (re-export)', () => {
  it('contains all host-native space IDs', () => {
    for (const id of HOST_NATIVE_SPACE_IDS) {
      expect(BUILTIN_SPACE_IDS).toContain(id)
    }
  })

  it('does not contain stale "projects" ID', () => {
    expect(BUILTIN_SPACE_IDS).not.toContain('projects')
  })

  it('matches HOST_NATIVE_SPACE_IDS exactly', () => {
    expect([...BUILTIN_SPACE_IDS].sort()).toEqual([...HOST_NATIVE_SPACE_IDS].sort())
  })
})

describe('manifest validation against HostNativeManifest contract', () => {
  for (const [id, manifest] of Object.entries(ALL_MANIFESTS)) {
    describe(`${id} manifest`, () => {
      it('passes validation with no errors', () => {
        const errors = validateHostNativeManifest(manifest)
        expect(errors).toEqual([])
      })

      it('has the correct id field', () => {
        expect(manifest.id).toBe(id)
      })

      it('has required string fields', () => {
        expect(typeof manifest.name).toBe('string')
        expect(typeof manifest.description).toBe('string')
        expect(typeof manifest.icon).toBe('string')
        expect(typeof manifest.version).toBe('string')
      })

      it('has valid scopes', () => {
        const scopes = (manifest as { scopes?: unknown }).scopes
        expect(Array.isArray(scopes)).toBe(true)
        for (const s of scopes as unknown[]) {
          expect(['app', 'org']).toContain(s)
        }
      })

      it('has a navigation object with required fields', () => {
        const nav = manifest.navigation as Record<string, unknown>
        expect(nav).toBeDefined()
        expect(typeof nav.label).toBe('string')
        expect(typeof nav.icon).toBe('string')
        expect(typeof nav.to).toBe('string')
        expect(typeof nav.order).toBe('number')
      })

      it('has at least one page with default: true', () => {
        const pages = manifest.pages as Array<{ path: string; label: string; default?: boolean }>
        expect(Array.isArray(pages)).toBe(true)
        expect(pages.length).toBeGreaterThan(0)
        expect(pages.some(p => p.default === true)).toBe(true)
      })

      it('manifest id is a host-native space', () => {
        expect(isHostNativeSpace(manifest.id as string)).toBe(true)
      })
    })
  }
})

describe('validateHostNativeManifest edge cases', () => {
  it('reports missing fields on empty object', () => {
    const errors = validateHostNativeManifest({})
    expect(errors.length).toBeGreaterThan(0)
    expect(errors.some(e => e.includes('id'))).toBe(true)
    expect(errors.some(e => e.includes('name'))).toBe(true)
    expect(errors.some(e => e.includes('description'))).toBe(true)
    expect(errors.some(e => e.includes('icon'))).toBe(true)
    expect(errors.some(e => e.includes('version'))).toBe(true)
    expect(errors.some(e => e.includes('scopes'))).toBe(true)
    expect(errors.some(e => e.includes('navigation'))).toBe(true)
    expect(errors.some(e => e.includes('pages'))).toBe(true)
  })

  it('reports invalid scopes value', () => {
    const errors = validateHostNativeManifest({
      id: 'test',
      name: 'Test',
      description: 'test',
      icon: 'lucide:test',
      version: '1.0.0',
      scopes: ['invalid'],
      navigation: { label: 'Test', icon: 'lucide:test', to: 'test', order: 1 },
      pages: [{ path: '', label: 'Test', default: true }],
    })
    expect(errors.some(e => e.includes('scopes'))).toBe(true)
  })

  it('rejects legacy single "scope" field', () => {
    const errors = validateHostNativeManifest({
      id: 'test',
      name: 'Test',
      description: 'test',
      icon: 'lucide:test',
      version: '1.0.0',
      scope: 'app',
      navigation: { label: 'Test', icon: 'lucide:test', to: 'test', order: 1 },
      pages: [{ path: '', label: 'Test', default: true }],
    })
    expect(errors.some(e => e.includes('"scope" is no longer supported'))).toBe(true)
  })

  it('reports missing default page', () => {
    const errors = validateHostNativeManifest({
      id: 'test',
      name: 'Test',
      description: 'test',
      icon: 'lucide:test',
      version: '1.0.0',
      scopes: ['app'],
      navigation: { label: 'Test', icon: 'lucide:test', to: 'test', order: 1 },
      pages: [{ path: '', label: 'Test' }],
    })
    expect(errors.some(e => e.includes('default'))).toBe(true)
  })

  it('returns empty array for valid manifest', () => {
    const errors = validateHostNativeManifest({
      id: 'test',
      name: 'Test',
      description: 'test',
      icon: 'lucide:test',
      version: '1.0.0',
      scopes: ['app'],
      navigation: { label: 'Test', icon: 'lucide:test', to: 'test', order: 1 },
      pages: [{ path: '', label: 'Test', default: true }],
    })
    expect(errors).toEqual([])
  })
})
