import { describe, expect, it } from 'vitest'
import {
  HOST_NATIVE_SPACE_IDS,
  isHostNativeSpace,
  validateHostNativeManifest,
} from '../../types/space'
import { BUILTIN_SPACE_IDS } from '../builtin'

import architectManifest from '../../spaces/architect/manifest.json'
import brainstormManifest from '../../spaces/brainstorm/manifest.json'
import coderManifest from '../../spaces/coder/manifest.json'
import projectManifest from '../../spaces/project/manifest.json'

const ALL_MANIFESTS: Record<string, Record<string, unknown>> = {
  architect: architectManifest as unknown as Record<string, unknown>,
  brainstorm: brainstormManifest as unknown as Record<string, unknown>,
  coder: coderManifest as unknown as Record<string, unknown>,
  project: projectManifest as unknown as Record<string, unknown>,
}

describe('space type discrimination', () => {
  it('identifies host-native space IDs', () => {
    expect(isHostNativeSpace('architect')).toBe(true)
    expect(isHostNativeSpace('brainstorm')).toBe(true)
    expect(isHostNativeSpace('coder')).toBe(true)
    expect(isHostNativeSpace('project')).toBe(true)
  })

  it('rejects non-host-native space IDs', () => {
    expect(isHostNativeSpace('code')).toBe(false)
    expect(isHostNativeSpace('design')).toBe(false)
    expect(isHostNativeSpace('kanban')).toBe(false)
    expect(isHostNativeSpace('projects')).toBe(false) // common typo
    expect(isHostNativeSpace('')).toBe(false)
  })

  it('HOST_NATIVE_SPACE_IDS contains exactly 4 entries', () => {
    expect(HOST_NATIVE_SPACE_IDS).toHaveLength(4)
  })

  it('HOST_NATIVE_SPACE_IDS contains the correct IDs', () => {
    const ids = [...HOST_NATIVE_SPACE_IDS].sort()
    expect(ids).toEqual(['architect', 'brainstorm', 'coder', 'project'])
  })
})

describe('BUILTIN_SPACE_IDS (re-export)', () => {
  it('contains all 4 host-native space IDs', () => {
    expect(BUILTIN_SPACE_IDS).toContain('architect')
    expect(BUILTIN_SPACE_IDS).toContain('brainstorm')
    expect(BUILTIN_SPACE_IDS).toContain('coder')
    expect(BUILTIN_SPACE_IDS).toContain('project')
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

      it('has a valid scope', () => {
        expect(['app', 'project', 'both']).toContain(manifest.scope)
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
    expect(errors.some(e => e.includes('scope'))).toBe(true)
    expect(errors.some(e => e.includes('navigation'))).toBe(true)
    expect(errors.some(e => e.includes('pages'))).toBe(true)
  })

  it('reports invalid scope value', () => {
    const errors = validateHostNativeManifest({
      id: 'test',
      name: 'Test',
      description: 'test',
      icon: 'lucide:test',
      version: '1.0.0',
      scope: 'invalid',
      navigation: { label: 'Test', icon: 'lucide:test', to: 'test', order: 1 },
      pages: [{ path: '', label: 'Test', default: true }],
    })
    expect(errors.some(e => e.includes('scope'))).toBe(true)
  })

  it('reports missing default page', () => {
    const errors = validateHostNativeManifest({
      id: 'test',
      name: 'Test',
      description: 'test',
      icon: 'lucide:test',
      version: '1.0.0',
      scope: 'app',
      navigation: { label: 'Test', icon: 'lucide:test', to: 'test', order: 1 },
      pages: [{ path: '', label: 'Test' }], // no default: true
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
      scope: 'app',
      navigation: { label: 'Test', icon: 'lucide:test', to: 'test', order: 1 },
      pages: [{ path: '', label: 'Test', default: true }],
    })
    expect(errors).toEqual([])
  })
})
