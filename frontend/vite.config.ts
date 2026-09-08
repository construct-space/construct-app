import { defineConfig, type PluginOption, type ProxyOptions } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'
import AutoImport from 'unplugin-auto-import/vite'
import Components from 'unplugin-vue-components/vite'
import { resolve } from 'path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Socket } from 'node:net'
import HttpAgent, { HttpsAgent } from 'agentkeepalive'
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
    // Bundle all CSS into a single stylesheet linked from index.html
    // synchronously, instead of one CSS chunk per lazy route. Lazy
    // route chunks each shipped their own CSS chunk that Vite injected
    // on-demand via dynamic <link> tags — those applied a paint or two
    // late, leaving the first render of any newly-loaded page with
    // unstyled buttons, broken grids, and slot positions snapped to the
    // pre-CSS layout. Reload fixed it because the browser had the CSS
    // cached and applied it before paint. Desktop bundle, no network
    // cost for the larger up-front CSS.
    cssCodeSplit: false,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        browser: resolve(__dirname, 'browser.html'),
      },
      // No `external` here: bare specifiers left unresolved in a prod
      // bundle throw "Module name, '…' does not resolve to a valid URL"
      // in WebKit because there is no import map in the Tauri webview.
      // Previously `@tauri-apps/api/window` was externalized to dedupe
      // with @construct-space/ui, but dedup is now handled by resolve
      // .dedupe below and through the shared host provider for IIFE
      // space bundles. Everything the main app imports is bundled.
    },
  },
  plugins: [
    vue(),
    // Dev-only: index.html carries a `upgrade-insecure-requests` CSP (kept
    // for production, where it rewrites http station-logo images to https
    // so macOS ATS doesn't block them). During `vite serve` the app bundle
    // is served by the HTTP dev server at http://localhost:60200, and that
    // CSP upgrades its OWN module requests (main.ts, vite/client env.mjs) to
    // https — which the dev server can't TLS-handshake, so the app fails to
    // boot with "A TLS error caused the secure connection to fail". Strip
    // the meta while serving; `vite build` keeps it for production.
    {
      name: 'construct:strip-uir-csp-in-dev',
      apply: 'serve',
      transformIndexHtml(html: string) {
        return html.replace(
          /[ \t]*<meta http-equiv="Content-Security-Policy" content="upgrade-insecure-requests"\s*\/>\r?\n?/i,
          '',
        )
      },
    },
    // Cast: @tailwindcss/vite returns Plugin & { api } which TS can't compare
    // against vite 8's Plugin<any> without an excessive-stack-depth error.
    tailwindcss() as PluginOption,
    AutoImport({
      imports: [
        'vue',
        'vue-router',
        'pinia',
        '@vueuse/core',
        {
          // Explicitly pin useNotification + notify to the host
          // composable so a developer never accidentally imports
          // vueuse's useNotification (different signature — browser
          // Notification API wrapper) when reaching for the toast.
          // Paired with the `ignore` list below, which blocks vueuse's
          // preset version from competing for the same symbol and
          // producing a "Duplicated imports" warning at dev-server
          // boot.
          '@/composables/useNotification': ['useNotification', 'notify'],
        },
      ],
      ignore: [
        // vueuse's preset exposes entries with the same names as our
        // host composables. Listing them here blocks the preset
        // registration so our explicit from-imports (and the
        // composables/ dir scan for others) win without triggering
        // the auto-import dedupe warning.
        'useDateFormat',
        'useLocalStorage',
        'useNotification',
        'notify',
        // `useStorage` in this project is the host's space-scoped storage
        // composable (gateway-proxied uploads), NOT vueuse's localStorage
        // wrapper. Block the vueuse entry so the dir scan wins.
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
    // vite 8 + @tailwindcss/vite produce a plugin union TS can't compare
    // against UserConfig without hitting the instantiation-depth limit
    // ("excessive stack depth"). Annotating to PluginOption[] gives the
    // checker a concrete target and short-circuits the deep comparison.
  ] as PluginOption[],
  resolve: {
    alias: {
      '@construct/sdk': resolve(__dirname, 'lib/constructSdk.ts'),
      '@construct-space/ui': resolve(__dirname, 'lib/constructUiRuntime.js'),
      '~': resolve(__dirname, '.'),
      '@': resolve(__dirname, '.'),
    },
    dedupe: ['vue', '@tauri-apps/api/window', '@tauri-apps/api/core', '@tauri-apps/api/event'],
  },
  server: {
    port: 60200,
    strictPort: true,
    hmr: {
      // Increase timeout to avoid WKWebView hangs during large HMR updates
      timeout: 10000,
    },
    // All backend traffic goes through the my.construct.space gateway.
    // Override GATEWAY_URL locally (e.g. http://localhost:8080) to hit a
    // local docker-compose stack instead of the live gateway.
    proxy: (() => {
      const gateway = process.env.GATEWAY_URL || 'https://my.construct.space'
      // CapRover's nginx in front of the gateway closes idle upstream
      // sockets after ~60s. The old fix was `keepAlive:false` (a fresh TLS
      // handshake per request), which dodged dead-socket 502s but meant a
      // burst of parallel calls (e.g. opening an inbox) opened a flood of
      // brand-new connections — any transient SYN drop on the route then
      // surfaced as `connect ETIMEDOUT`. Use agentkeepalive instead: reuse
      // sockets (far fewer fresh connects) but set freeSocketTimeout below
      // CapRover's 60s cutoff so we always close a socket before the server
      // kills it — keeping the reuse win without the dead-socket regression.
      const Agent = gateway.startsWith('https://') ? HttpsAgent : HttpAgent
      const agent = new Agent({
        keepAlive: true,
        maxSockets: 64,
        maxFreeSockets: 8,
        timeout: 60_000,        // socket inactivity (working socket)
        freeSocketTimeout: 30_000, // < CapRover's ~60s idle close
      })
      // Retry idempotent requests once on a transient connect-level failure
      // so a single dropped SYN self-heals instead of spamming the log. Only
      // safe before any bytes have been sent to the client and only for
      // methods with no body side effects.
      const RETRYABLE = new Set(['ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED', 'EPIPE'])
      const IDEMPOTENT = new Set(['GET', 'HEAD', 'OPTIONS'])
      const retriedRequests = new WeakSet<IncomingMessage>()
      const configure: NonNullable<ProxyOptions['configure']> = (proxy) => {
        proxy.on('error', (err: NodeJS.ErrnoException, req: IncomingMessage, resOrSocket: ServerResponse | Socket) => {
          const isResponse = (r: ServerResponse | Socket): r is ServerResponse =>
            typeof (r as ServerResponse).writeHead === 'function'
          const canRetry =
            !retriedRequests.has(req) &&
            err?.code != null && RETRYABLE.has(err.code) &&
            IDEMPOTENT.has((req.method || 'GET').toUpperCase()) &&
            isResponse(resOrSocket) &&
            !resOrSocket.headersSent
          if (canRetry) {
            retriedRequests.add(req)
            proxy.web(req, resOrSocket as ServerResponse, { target: gateway, changeOrigin: true, agent })
            return
          }
          if (isResponse(resOrSocket) && !resOrSocket.headersSent) {
            resOrSocket.writeHead(502, { 'Content-Type': 'text/plain' })
            resOrSocket.end(`proxy error: ${err?.code || err?.message || 'upstream unreachable'}`)
          }
        })
      }
      const opts = {
        target: gateway,
        changeOrigin: true,
        agent,
        timeout: 60_000,        // client→proxy socket timeout
        proxyTimeout: 60_000,   // proxy→upstream timeout
        configure,
      }
      // WebSocket upgrades (/api/device-bus/ws etc) need ws:true to
      // be forwarded — vite/http-proxy doesn't proxy WS by default.
      const wsOpts = { ...opts, ws: true as const }
      return {
        '/api':    wsOpts,
        '/health': opts,
        '/media':  opts,
      }
    })(),
  },
  optimizeDeps: {
    include: ['@tauri-apps/api/window', '@tauri-apps/api/core', '@tauri-apps/api/event'],
  },
  // Clear screen disabled for Tauri integration
  clearScreen: false,
  define: {

    __APP_VERSION__: JSON.stringify(pkg.version),
  },
})
