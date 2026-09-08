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
    'lucide-vue-next',
    'date-fns',
    'dexie',
    'zod',
    '@construct-space/ui',
    '@construct-space/sdk',
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
    expect(new Set(EXPECTED_PACKAGES).size).toBe(EXPECTED_PACKAGES.length)
  })

  it('HOST_API_VERSION is exported and follows semver', async () => {
    // HOST_API_VERSION is defined in spaceHostConstants.ts (canonical source)
    // and re-exported from spaceHost.ts. Check the constants file directly.
    const { readFileSync } = await import('fs')
    const { resolve } = await import('path')
    const constantsSource = readFileSync(
      resolve(__dirname, '..', 'spaceHostConstants.ts'),
      'utf-8',
    )

    // Verify the export exists in the canonical source
    expect(constantsSource).toContain('HOST_API_VERSION')

    // Extract the version string and verify semver format
    const match = constantsSource.match(/HOST_API_VERSION\s*=\s*'(\d+\.\d+\.\d+)'/)
    expect(match).not.toBeNull()
    expect(match![1]).toMatch(/^\d+\.\d+\.\d+$/)

    // Verify spaceHost.ts re-exports it
    const hostSource = readFileSync(
      resolve(__dirname, '..', 'spaceHost.ts'),
      'utf-8',
    )
    expect(hostSource).toContain('HOST_API_VERSION')
  })
})

// ── Layer 1.5: SDK runtime shape parity ──

describe('SDK runtime shape parity', () => {
  it('host compatibility wrappers expose the SDK-declared aliases and native host shape', async (ctx) => {
    const { readFileSync, existsSync } = await import('fs')
    const { resolve } = await import('path')
    const hostSource = readFileSync(
      resolve(__dirname, '..', 'constructSdk.ts'),
      'utf-8',
    )
    // The SDK lives in a sibling checkout, not this repo.
    // CONSTRUCT_SDK_PATH (path to the sdk repo root) is authoritative when
    // set — and a wrong value FAILS the test instead of skipping, so a
    // configured CI can't silently lose the parity check. Without it, fall
    // back to known sibling layouts: <root>/packages/sdk next to
    // <root>/apps/<this repo> (current), and <parent>/packages/sdk
    // (pre-apps/ layout). Only when nothing is configured AND no sibling
    // exists (bare checkout) does the test skip.
    const envSdkRoot = process.env.CONSTRUCT_SDK_PATH
    if (envSdkRoot) {
      const p = resolve(envSdkRoot, 'src', 'runtime.ts')
      expect(existsSync(p), `CONSTRUCT_SDK_PATH is set but ${p} does not exist`).toBe(true)
    }
    const sdkCandidates = envSdkRoot
      ? [resolve(envSdkRoot, 'src', 'runtime.ts')]
      : [
          resolve(__dirname, '..', '..', '..', '..', '..', 'packages', 'sdk', 'src', 'runtime.ts'),
          resolve(__dirname, '..', '..', '..', '..', 'packages', 'sdk', 'src', 'runtime.ts'),
        ]
    const sdkRuntimePath = sdkCandidates.find(p => existsSync(p))
    if (!sdkRuntimePath) {
      console.warn('[hostContractParity] SDK checkout not found (set CONSTRUCT_SDK_PATH to enforce) — skipping parity check')
      ctx.skip()
      return
    }
    const sdkRuntimeSource = readFileSync(sdkRuntimePath, 'utf-8')

    const contracts = [
      {
        name: 'useSkills',
        host: ['export function useSkills()', 'const list = computed', 'const byId ='],
        sdk: ['export declare function useSkills()', 'skills:', 'list:', 'byId('],
      },
      {
        name: 'useSpaces',
        host: ['export function useSpaces()', 'const installed = computed', 'const byId ='],
        sdk: ['export declare function useSpaces()', 'spaces:', 'installed:', 'byId('],
      },
      {
        name: 'useSpaceMarketplace',
        host: ['export function useSpaceMarketplace()', 'const search = async'],
        sdk: ['export declare function useSpaceMarketplace()', 'searchRemote(', 'search(query: string)'],
      },
      {
        name: 'useCredits',
        host: ['export function useCredits()', 'const refresh = async'],
        sdk: ['export declare function useCredits()', 'fetchBalance()', 'refresh()'],
      },
      {
        name: 'useBilling',
        host: ['export function useBilling()', 'const plan = computed', 'const status = computed', 'const openPortal = async'],
        sdk: ['export declare function useBilling()', 'currentPlan:', 'plan:', 'status:', 'openPortal()'],
      },
      {
        name: 'useAIModel',
        host: ['export function useAIModel()', 'const available = computed', 'const active =', 'const setActive ='],
        sdk: ['export declare function useAIModel()', 'allModels:', 'available:', 'active:', 'setActive('],
      },
      {
        name: 'useSpaceTool',
        host: ["export { useSpaceTool } from '@/composables/useSpaceTool'"],
        sdk: ['export declare function useSpaceTool(', 'SPACE_DIR', 'SPACE_LIB'],
      },
      {
        name: 'desktop file facades',
        host: ['export async function pickLocalDirectory(', 'export function resolveLocalFileUrl('],
        sdk: ['export declare function pickLocalDirectory(', 'export declare function resolveLocalFileUrl('],
      },
    ]

    for (const contract of contracts) {
      for (const snippet of contract.host) {
        expect(hostSource, `${contract.name} host wrapper should include ${snippet}`).toContain(snippet)
      }
      for (const snippet of contract.sdk) {
        expect(sdkRuntimeSource, `${contract.name} SDK declaration should include ${snippet}`).toContain(snippet)
      }
    }
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
    expect(source).toContain("from '@/brain/types'")
    expect(source).toContain("from '@/brain/types'")
    expect(source).toContain("from '@/lib/spaceContextBus'")
  })
})
