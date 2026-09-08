import { createApp } from 'vue'
import { createPinia } from 'pinia'
import { router } from './router'
import App from './App.vue'
import './assets/css/main.css'
import { Icon } from './lib/constructUiRuntime.js'
import Notification from './components/common/Notification.vue'
import { installConsoleToFile } from './lib/consoleToFile'
import { installErrorTracker } from './lib/errorTracker'

// Initialize space host globals early so window.__CONSTRUCT__ is
// available before any space IIFE bundles are loaded/evaluated.
import { initSpaceHost } from './lib/spaceHost'
initSpaceHost()

async function boot() {
  // Mirror console.* into the Tauri log file BEFORE mounting. Otherwise
  // early logs from shells / bootstrap miss the hook and never reach disk.
  await installConsoleToFile()

  const app = createApp(App)
  app.use(createPinia())
  app.use(router)
  app.component('Icon', Icon)
  app.component('Notification', Notification)
  installErrorTracker(app)
  app.mount('#app')

  // Dev-only console handle: `__notify('msg', 'success')` pushes a toast
  // through the same host singleton the app uses. Handy for verifying
  // the stack works without wiring up a new caller. Stripped in prod.
  if (import.meta.env.DEV) {
    const { notify } = await import('./composables/useNotification')
    ;(window as unknown as { __notify?: typeof notify }).__notify = notify
  }
}

void boot()
