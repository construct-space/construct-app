import { createApp } from 'vue'
import { createPinia } from 'pinia'
import { router } from './router'
import App from './App.vue'
import './assets/css/main.css'
import { Icon, Notification } from './lib/constructUiRuntime.js'

// Initialize space host globals early so window.__CONSTRUCT__ is
// available before any space IIFE bundles are loaded/evaluated.
import { initSpaceHost } from './lib/spaceHost'
initSpaceHost()

const app = createApp(App)
app.use(createPinia())
app.use(router)
app.component('Icon', Icon)
app.component('Notification', Notification)

// Keep the icon/notification primitives global because they are used pervasively
// across host-owned views. Other shared UI components resolve through
// unplugin-vue-components or package imports.

// Initialize auth, then project store, then mount
import { useAuthStore } from './stores/auth'
import { useProjectStore } from './stores/project'
// Spaces are user-managed — no auto-install

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

})
