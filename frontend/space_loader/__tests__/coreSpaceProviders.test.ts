import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

// Guards the single-source-of-truth refactor: the assistant's headless
// space actions are driven off the `createAutomationProvider` field on
// CORE_SPACES entries (coreSpaces.ts), NOT a separate hand-maintained list.
// If someone reintroduces a parallel id→module list in coreSpaceProviders.ts,
// it drifts from CORE_SPACES and a new host-native space silently loses its
// actions. Asserted on source text because importing coreSpaces.ts drags the
// whole host-native page graph (module-level store side effects) into node.
describe('core space providers derive from CORE_SPACES', () => {
  const providersSrc = readFileSync(
    resolve(__dirname, '..', '..', 'lib', 'coreSpaceProviders.ts'),
    'utf-8',
  )
  const coreSpacesSrc = readFileSync(
    resolve(__dirname, '..', 'coreSpaces.ts'),
    'utf-8',
  )

  it('registers from the CORE_SPACES-derived accessor', () => {
    expect(providersSrc).toContain('getCoreSpaceProviderFactories')
  })

  it('keeps no parallel hardcoded provider list', () => {
    // The old shape was a CORE_PROVIDERS array of [id, () => import(...)] tuples.
    expect(providersSrc).not.toContain('CORE_PROVIDERS')
    expect(providersSrc).not.toMatch(/import\(['"]@\/spaces\/[^'"]+\/composables\/useAutomationProvider['"]\)/)
  })

  it('wires every action-bearing core space in CORE_SPACES', () => {
    for (const id of ['org', 'project', 'org-project']) {
      // Each entry must carry createAutomationProvider so the accessor picks it up.
      const entry = new RegExp(`['"]?${id}['"]?:\\s*\\{[\\s\\S]*?createAutomationProvider:`, 'm')
      expect(coreSpacesSrc).toMatch(entry)
    }
  })
})
