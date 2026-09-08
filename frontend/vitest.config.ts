import { readdirSync } from 'fs'
import { resolve } from 'path'
import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'

// Resolve a package inside bun's content-addressed store
// (node_modules/.bun/<name>@<version>+<hash>/node_modules/<sub>). Returns
// undefined when the store layout isn't present (e.g. a non-bun install), so
// the alias is simply skipped and vite falls back to normal resolution.
const bunStore = resolve(__dirname, '../node_modules/.bun')
function bunPkg(prefix: string, sub: string): string | undefined {
  try {
    const match = readdirSync(bunStore).find((d) => d.startsWith(prefix))
    return match ? resolve(bunStore, match, 'node_modules', sub) : undefined
  } catch {
    return undefined
  }
}

// Pin Vue to a single physical copy for the test env. Under bun's split
// layout, @construct-space/ui and @vue/test-utils each resolve their own
// `import ... from "vue"` to a different @vue/runtime-core instance. Those
// instances hold separate module-level currentRenderingInstance, so when
// test-utils' mount renders a UI Card the lib's renderSlot reads null and
// crashes ("Cannot read properties of null (reading 'ce')"). Aliasing every
// Vue entry to the one .bun copy the renderer uses unifies the instance.
const vueAlias: Record<string, string> = {}
for (const [prefix, sub] of [
  ['vue@', 'vue'],
  ['@vue+runtime-core@', '@vue/runtime-core'],
  ['@vue+runtime-dom@', '@vue/runtime-dom'],
  ['@vue+reactivity@', '@vue/reactivity'],
  ['@vue+shared@', '@vue/shared'],
] as const) {
  const p = bunPkg(prefix, sub)
  if (p) vueAlias[sub] = p
}

export default defineConfig({
  plugins: [vue()],
  test: {
    environment: 'jsdom',
    include: [
      'frontend/**/*.test.ts',
      'frontend/**/*.spec.ts',
    ],
    server: {
      deps: {
        // Inline the UI lib and test-utils so they go through vite's module
        // graph (and the vueAlias above) instead of being externalized to
        // their own Vue copy. Required alongside the alias for the fix.
        inline: [/@construct-space\/ui/, /@vue\/test-utils/],
      },
    },
  },
  resolve: {
    alias: {
      '@construct/sdk': resolve(__dirname, 'lib/constructSdk.ts'),
      '@': resolve(__dirname, '.'),
      '~': resolve(__dirname, '.'),
      ...vueAlias,
    },
    dedupe: ['vue', '@vue/runtime-core', '@vue/runtime-dom', '@vue/reactivity', '@vue/shared'],
  },
})
