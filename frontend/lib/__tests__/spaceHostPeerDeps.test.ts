import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// `lib/spaceHost.ts` does `import * as VueUseIntegrations from '@vueuse/integrations'`
// which transitively requires several optional peers at bundle/runtime.
// Each one missing → "Could not resolve <name> imported by @vueuse/integrations"
// when rolldown builds the production bundle. Vitest's node resolver is
// lenient enough to load the package without these, so a runtime import
// test won't catch the regression. Pin them as hard deps in package.json
// instead and assert it here.
//
// NOTE: read package.json via fs (not require/import) — the package's
// `exports` map sends `./*` to `./dist/*`, so any subpath resolution sees
// `./dist/package.json` (which doesn't exist) instead of the real file.
const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const vueUseIntegrationsPkgPath = resolve(
  __dirname, '..', '..', '..', 'node_modules', '@vueuse', 'integrations', 'package.json',
)
const vueUseIntegrationsPkg = JSON.parse(
  readFileSync(vueUseIntegrationsPkgPath, 'utf-8'),
) as {
  optionalPeers?: string[]
  peerDependencies?: Record<string, string>
}

const REQUIRED_PEERS = [
  ...Object.keys(vueUseIntegrationsPkg.peerDependencies ?? {}),
  ...(vueUseIntegrationsPkg.optionalPeers ?? []),
].filter((name, index, peers) => peers.indexOf(name) === index)

describe('spaceHost peer deps', () => {
  it('package.json declares every transitive @vueuse/integrations peer', async () => {
    const { readFileSync } = await import('fs')
    const { resolve } = await import('path')
    const pkgPath = resolve(__dirname, '..', '..', '..', 'package.json')
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'))
    const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) }
    for (const name of REQUIRED_PEERS) {
      expect(
        Object.hasOwn(deps, name),
        `missing ${name}: rolldown will fail with "Could not resolve ${name} imported by @vueuse/integrations"`,
      ).toBe(true)
    }
  })
})
