import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'
import AutoImport from 'unplugin-auto-import/vite'
import Components from 'unplugin-vue-components/vite'
import { resolve } from 'path'
import pkg from '../package.json'

const sharedUiComponents = new Set([
  'Accordion',
  'Alert',
  'Autocomplete',
  'Avatar',
  'Badge',
  'Breadcrumbs',
  'Button',
  'Calendar',
  'Card',
  'Checkbox',
  'Chip',
  'ColorPicker',
  'ContextMenu',
  'DashboardPanel',
  'DatePicker',
  'Drawer',
  'Dropdown',
  'DropdownMenu',
  'DropdownMenuItem',
  'Empty',
  'FileInput',
  'FormField',
  'Group',
  'HeaderLayout',
  'Icon',
  'Input',
  'Kbd',
  'Modal',
  'MultiSelect',
  'Notification',
  'Pagination',
  'PanelSection',
  'Popover',
  'Progress',
  'PropRow',
  'RadioGroup',
  'ScrollArea',
  'Select',
  'SelectMenu',
  'Separator',
  'SidebarLayout',
  'Skeleton',
  'Slideover',
      'Slider',
      'Switch',
      'Tab',
      'Table',
      'Tabs',
      'Textarea',
      'Timeline',
      'ToggleGroup',
      'Tooltip',
      'Tree',
])

export default defineConfig({
  root: resolve(__dirname),
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    chunkSizeWarningLimit: 1000,
  },
  plugins: [
    vue(),
    tailwindcss(),
    AutoImport({
      imports: [
        'vue',
        'vue-router',
        'pinia',
        '@vueuse/core',
        {
          '@construct-space/ui': ['useNotification', 'notify'],
        },
      ],
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
      resolvers: [
        (componentName) => {
          if (sharedUiComponents.has(componentName)) {
            return { name: componentName, from: '@construct-space/ui' }
          }
        },
      ],
      dts: 'components.d.ts',
    }),
  ],
  resolve: {
    alias: {
      '@construct/sdk': resolve(__dirname, 'lib/constructSdk.ts'),
      '@construct-space/ui': resolve(__dirname, 'lib/constructUiRuntime.js'),
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
