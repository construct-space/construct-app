import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'
import AutoImport from 'unplugin-auto-import/vite'
import Components from 'unplugin-vue-components/vite'
import { resolve } from 'path'
import pkg from '../package.json'

export default defineConfig({
  root: resolve(__dirname),
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  plugins: [
    vue(),
    tailwindcss(),
    AutoImport({
      imports: ['vue', 'vue-router', 'pinia', '@vueuse/core'],
      ignore: [
        // Local overrides in composables/ take precedence
        'useDateFormat',
        'useStorage',
      ],
      dirs: [
        'composables',
        'stores',
        'utils',
      ],
      dts: 'auto-imports.d.ts',
      vueTemplate: true,
    }),
    Components({
      dirs: [
        'components',
        'components/media',
        // Space components are no longer auto-registered globally.
        // In dev, SpaceLoader uses import.meta.glob to load space pages.
        // In prod, spaces ship as self-contained IIFE bundles.
      ],
      dts: 'components.d.ts',
    }),
  ],
  resolve: {
    alias: {
      '@construct/sdk': resolve(__dirname, 'lib/constructSdk.ts'),
      '~': resolve(__dirname, '.'),
      '@': resolve(__dirname, '.'),
    },
    dedupe: ['vue'],
  },
  // server: {
  //   port: 3050,
  //   strictPort: true,
  //   proxy: {
  //     '/api': 'http://localhost:8000',
  //     '/health': 'http://localhost:8000',
  //     '/media': 'http://localhost:8000',
  //   },
  // },
  server: {
    port: 60200,
    strictPort: true,
    proxy: {
      '/api': 'https://source.construct.space',
      '/health': 'https://source.construct.space',
      '/media': 'https://source.construct.space',
    },
  },
  // Clear screen disabled for Tauri integration
  clearScreen: false,
  // Nuxt compatibility: import.meta.client/server are Nuxt-specific.
  // Since this is always a client-side SPA, define them as constants.
  define: {
    'import.meta.client': 'true',
    'import.meta.server': 'false',
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
})
