import { createApp } from 'vue'
import { createPinia } from 'pinia'
import { router } from './router'
import App from './App.vue'
import './assets/css/main.css'

// Initialize space host globals early so window.__CONSTRUCT__ is
// available before any space IIFE bundles are loaded/evaluated.
import { initSpaceHost } from './lib/spaceHost'
initSpaceHost()

const app = createApp(App)
app.use(createPinia())
app.use(router)

// UI components are NOT registered globally to avoid stack overflow with
// unplugin-vue-components. Instead, space IIFE bundles import them via
// @construct/sdk (auto-imported from host-api.ts exports).
// Host .vue files get them via unplugin-vue-components auto-import.

// Initialize auth, then project store, then mount
import { useAuthStore } from './stores/auth'
import { useProjectStore } from './stores/project'
import { autoInstallRecommended, ensureEssentialSpaces } from './composables/useSpaceMarketplace'

// Start desktop bridge listener only in the main window.
// Other windows (standalone-assistant, browser tabs) must not compete for bridge requests.
import { startBridgeListener } from './lib/bridgeListener'
import('@tauri-apps/api/webviewWindow').then(({ getCurrentWebviewWindow }) => {
  if (getCurrentWebviewWindow().label === 'main') {
    startBridgeListener().catch(err => {
      console.warn('[main] Bridge listener:', err)
    })
  }
}).catch(() => { /* not in Tauri */ })

const authStore = useAuthStore()
authStore.initialize().then(() => {
  app.mount('#app')

  // Lazy — non-blocking background init
  const projectStore = useProjectStore()
  projectStore.initialize().catch(err => {
    console.warn('[main] Project store init:', err)
  })

  autoInstallRecommended().catch(err => {
    console.warn('[main] Auto-install recommended spaces:', err)
  })

  ensureEssentialSpaces().catch(err => {
    console.warn('[main] Ensure essential spaces:', err)
  })
})
