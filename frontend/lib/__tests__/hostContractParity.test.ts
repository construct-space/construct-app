/**
 * Host Contract Parity Tests
 *
 * Verifies that:
 * 1. HOST_PROVIDED_PACKAGES list matches what initSpaceHost actually exposes
 * 2. SDK types are exported and importable by space authors
 * 3. window.construct runtime shape matches the documented contract
 */

import { describe, it, expect } from 'vitest'

// ── Layer 1: HOST_PROVIDED_PACKAGES parity ──

describe('HOST_PROVIDED_PACKAGES parity', () => {
  /**
   * The canonical list of packages that initSpaceHost() exposes on
   * window.__CONSTRUCT__. If a package is added/removed in spaceHost.ts,
   * this test must be updated to match.
   */
  const EXPECTED_PACKAGES = [
    'vue',
    'vue-router',
    'pinia',
    '@vueuse/core',
    '@vueuse/integrations',
    '@tauri-apps/api',
    '@tauri-apps/api/core',
    '@tauri-apps/api/path',
    '@tauri-apps/api/event',
    '@tauri-apps/api/webview',
    '@tauri-apps/plugin-fs',
    '@tauri-apps/plugin-shell',
    '@tauri-apps/plugin-dialog',
    '@tauri-apps/plugin-process',
    'lucide-vue-next',
    'date-fns',
    'dexie',
    'zod',
    '@construct-space/ui',
    '@construct/sdk',
    '@construct-space/sdk', // backward compat alias
  ]

  it('initSpaceHost source contains all expected package keys', async () => {
    // Read the source file to verify the keys without executing in a browser
    const { readFileSync } = await import('fs')
    const { resolve } = await import('path')
    const source = readFileSync(
      resolve(__dirname, '..', 'spaceHost.ts'),
      'utf-8',
    )

    for (const pkg of EXPECTED_PACKAGES) {
      expect(
        source.includes(`'${pkg}'`),
        `spaceHost.ts should expose package '${pkg}'`,
      ).toBe(true)
    }
  })

  it('expected packages list has no duplicates', () => {
    const unique = new Set(EXPECTED_PACKAGES)
    // @construct-space/sdk is a deliberate backward-compat alias for @construct/sdk
    // so we allow those two to coexist but no other duplicates
    const withoutAlias = EXPECTED_PACKAGES.filter(p => p !== '@construct-space/sdk')
    const uniqueWithoutAlias = new Set(withoutAlias)
    expect(uniqueWithoutAlias.size).toBe(withoutAlias.length)
  })

  it('HOST_API_VERSION is exported and follows semver', async () => {
    // Import in test environment fails because spaceHost.ts imports heavy
    // browser-only dependencies. Parse the source directly instead.
    const { readFileSync } = await import('fs')
    const { resolve } = await import('path')
    const source = readFileSync(
      resolve(__dirname, '..', 'spaceHost.ts'),
      'utf-8',
    )

    // Verify the export exists
    expect(source).toContain('HOST_API_VERSION')

    // Extract the version string and verify semver format
    const match = source.match(/HOST_API_VERSION\s*=\s*'(\d+\.\d+\.\d+)'/)
    expect(match).not.toBeNull()
    expect(match![1]).toMatch(/^\d+\.\d+\.\d+$/)
  })
})

// ── Layer 2: window.construct runtime shape ──

describe('ConstructRuntime shape', () => {
  it('spaceHost.ts declares the ConstructRuntime interface with required fields', async () => {
    const { readFileSync } = await import('fs')
    const { resolve } = await import('path')
    const source = readFileSync(
      resolve(__dirname, '..', 'spaceHost.ts'),
      'utf-8',
    )

    // Verify all ConstructRuntime fields are present in the interface
    const requiredFields = ['config', 'auth', 'space', 'project', 'operator', 'storage']
    for (const field of requiredFields) {
      expect(
        source.includes(`${field}:`),
        `ConstructRuntime should have field '${field}'`,
      ).toBe(true)
    }

    // Verify config sub-fields
    expect(source).toContain('graphUrl')
    expect(source).toContain('apiBase')

    // Verify auth sub-fields
    expect(source).toContain('getAccessToken')
    expect(source).toContain('getUserId')

    // Verify operator sub-fields
    expect(source).toContain('send(type: string')

    // Verify storage sub-fields
    expect(source).toContain('get(key: string)')
    expect(source).toContain('set(key: string')
    expect(source).toContain('remove(key: string)')
  })
})

// ── SDK types exports ──

describe('SDK type exports', () => {
  it('exports SpaceManifest type', async () => {
    const mod = await import('../../types/sdk')
    // Type-only exports don't have runtime values, but the module should load
    expect(mod).toBeDefined()
  })

  it('sdk.ts re-exports all documented types', async () => {
    const { readFileSync } = await import('fs')
    const { resolve } = await import('path')
    const source = readFileSync(
      resolve(__dirname, '..', '..', 'types', 'sdk.ts'),
      'utf-8',
    )

    // Core types that space authors need
    const requiredExports = [
      'SpaceManifest',
      'ToolbarItem',
      'ToolbarBreadcrumb',
      'Turn',
      'RequestBlock',
      'ResponseBlock',
      'SpaceToolbarItem',
      'AssistantTypeConfig',
      'OperatorAgent',
      'StreamEvent',
      'SpaceContextPayload',
      'AutomationProvider',
    ]

    for (const name of requiredExports) {
      expect(
        source.includes(name),
        `sdk.ts should export type '${name}'`,
      ).toBe(true)
    }
  })

  it('sdk.ts sources types from correct modules', async () => {
    const { readFileSync } = await import('fs')
    const { resolve } = await import('path')
    const source = readFileSync(
      resolve(__dirname, '..', '..', 'types', 'sdk.ts'),
      'utf-8',
    )

    // Verify source modules
    expect(source).toContain("from '@/space_loader/SpaceLoader'")
    expect(source).toContain("from '@/composables/useToolbar'")
    expect(source).toContain("from '@/assistant/blocks'")
    expect(source).toContain("from '@/assistant/types'")
    expect(source).toContain("from '@/operator/types'")
    expect(source).toContain("from '@/operator/streamEvents'")
    expect(source).toContain("from '@/lib/spaceContextBus'")
  })
})
