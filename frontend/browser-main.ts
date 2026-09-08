import { createApp } from 'vue'
import { createPinia } from 'pinia'
import BrowserApp from './browser/BrowserApp.vue'
import './assets/css/main.css'
import { installConsoleToFile } from './lib/consoleToFile'

async function boot() {
  await installConsoleToFile('browser-main')
  const app = createApp(BrowserApp)
  app.use(createPinia())
  app.mount('#browser-app')
}

void boot()
