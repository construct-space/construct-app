<script setup lang="ts">
/**
 * SystemSettings — System info, updates & diagnostics
 */
import { IS_DEV_INSTANCE } from '@/lib/appPaths'
import { useUpdater } from '@/composables/useUpdater'
import { useDevMode } from '@/composables/useDevMode'
import { useOperator } from '@/operator'
import Switch from '@/components/ui/Switch.vue'
import Button from '@/components/ui/Button.vue'

// ── System info ──
const appVersion = ref('')
const osInfo = ref({ platform: '', arch: '', version: '' })
const hostname = ref('')
const locale = ref('')
const operator = useOperator()
const bridgeStatus = ref<'checking' | 'connected' | 'unreachable' | 'disabled'>('checking')
const operatorStatus = ref<'checking' | 'connected' | 'unreachable'>('checking')
const memoryUsage = ref('')
const uptime = ref('')
const startTime = Date.now()

let uptimeInterval: ReturnType<typeof setInterval> | null = null

function formatUptime(ms: number): string {
  const seconds = Math.floor(ms / 1000)
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const secs = seconds % 60
  if (hours > 0) return `${hours}h ${minutes}m`
  if (minutes > 0) return `${minutes}m ${secs}s`
  return `${secs}s`
}

// ── Updates ──
const {
  updateAvailable, updateInfo, isChecking, isDownloading, downloadProgress, error,
  checkForUpdates, downloadAndInstall, getAutoCheck, setAutoCheck, getLastChecked,
} = useUpdater()

const { updaterDisabled } = useDevMode()
const lastChecked = ref<Date | null>(getLastChecked())
const autoCheck = ref(getAutoCheck())

watch(autoCheck, (val) => {
  if (!updaterDisabled.value) setAutoCheck(val)
})

async function handleCheck() {
  if (updaterDisabled.value) return
  await checkForUpdates()
  lastChecked.value = new Date()
}

async function handleInstall() {
  if (updaterDisabled.value) return
  await downloadAndInstall()
}

// ── Init ──
onMounted(async () => {
  try {
    const { getVersion } = await import('@tauri-apps/api/app')
    appVersion.value = await getVersion()
  } catch {
    appVersion.value = __APP_VERSION__
  }

  try {
    const os = await import('@tauri-apps/plugin-os')
    osInfo.value = {
      platform: os.platform(),
      arch: os.arch(),
      version: os.version(),
    }
    hostname.value = await os.hostname() || ''
    locale.value = await os.locale() || ''
  } catch { /* web context */ }

  // Check operator & bridge connections
  try {
    const info = await operator.send<{ bridgeStatus?: string }>('system.info', {})
    operatorStatus.value = 'connected'
    bridgeStatus.value = (info?.bridgeStatus as 'connected' | 'unreachable' | 'disabled') || 'unreachable'
  } catch {
    operatorStatus.value = 'unreachable'
    bridgeStatus.value = 'unreachable'
  }

  if ((performance as any).memory) {
    const mem = (performance as any).memory
    memoryUsage.value = `${Math.round(mem.usedJSHeapSize / 1024 / 1024)} MB`
  }

  uptime.value = formatUptime(Date.now() - startTime)
  uptimeInterval = setInterval(() => {
    uptime.value = formatUptime(Date.now() - startTime)
  }, 60_000)

  if (!updaterDisabled.value) {
    handleCheck()
  }
})

onUnmounted(() => {
  if (uptimeInterval) clearInterval(uptimeInterval)
})

const activeTab = ref<'updates' | 'system'>('updates')

const platformName = computed(() => {
  const names: Record<string, string> = { darwin: 'macOS', win32: 'Windows', linux: 'Linux' }
  return names[osInfo.value.platform] || osInfo.value.platform
})

const archName = computed(() => {
  const names: Record<string, string> = { aarch64: 'Apple Silicon (arm64)', x86_64: 'Intel (x86_64)' }
  return names[osInfo.value.arch] || osInfo.value.arch
})
</script>

<template>
  <div class="space-y-6">
    <!-- Tabs -->
    <div class="flex gap-1 p-1 bg-[color-mix(in_srgb,var(--app-muted)_8%,transparent)] rounded-lg w-fit">
      <button
        class="px-4 py-1.5 text-sm rounded-md transition-colors cursor-pointer"
        :class="activeTab === 'updates' ? 'bg-app-accent text-white' : 'text-[var(--app-muted)] hover:text-[var(--app-foreground)]'"
        @click="activeTab = 'updates'"
      >Updates</button>
      <button
        class="px-4 py-1.5 text-sm rounded-md transition-colors cursor-pointer"
        :class="activeTab === 'system' ? 'bg-app-accent text-white' : 'text-[var(--app-muted)] hover:text-[var(--app-foreground)]'"
        @click="activeTab = 'system'"
      >System Info</button>
    </div>

    <!-- Updates tab -->
    <div v-if="activeTab === 'updates'">
      <div class="flex items-center justify-between mb-4">
        <div>
          <p class="text-sm font-medium text-[var(--app-foreground)]">Construct v{{ appVersion }}</p>
          <p v-if="lastChecked" class="text-xs text-[var(--app-muted)]">Last checked: {{ lastChecked.toLocaleString() }}</p>
        </div>
        <Button variant="soft" :loading="isChecking" :disabled="isDownloading || updaterDisabled" label="Check for Updates" @click="handleCheck" />
      </div>

      <div v-if="updaterDisabled" class="p-4 rounded-lg bg-orange-500/5 border border-orange-500/20 mb-4">
        <div class="flex items-start gap-3">
          <svg class="w-5 h-5 text-orange-400 shrink-0 mt-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 9v4" /><path d="M12 17h.01" /><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" /></svg>
          <div>
            <p class="text-sm font-medium text-[var(--app-foreground)]">Updates disabled in developer mode</p>
            <p class="text-xs text-[var(--app-muted)] mt-1">Disable developer mode in Settings &gt; Developer to re-enable.</p>
          </div>
        </div>
      </div>

      <div v-if="error && !isChecking" class="p-4 rounded-lg bg-red-500/5 border border-red-500/20 mb-4">
        <div class="flex items-start gap-3">
          <svg class="w-5 h-5 text-red-400 shrink-0 mt-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg>
          <div>
            <p class="text-sm font-medium text-[var(--app-foreground)]">Update check failed</p>
            <p class="text-xs text-[var(--app-muted)] mt-1">{{ error }}</p>
          </div>
        </div>
      </div>

      <!-- Update available -->
      <div v-if="updateAvailable && updateInfo" class="p-4 rounded-lg bg-[color-mix(in_srgb,var(--app-accent)_10%,transparent)] border border-[var(--app-accent)]/20">
        <div class="flex items-start gap-4">
          <div class="p-2 rounded-lg bg-[color-mix(in_srgb,var(--app-accent)_20%,transparent)]">
            <svg class="w-5 h-5 text-app-accent" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>
          </div>
          <div class="flex-1">
            <h4 class="text-sm font-medium text-[var(--app-foreground)]">Update Available: v{{ updateInfo.version }}</h4>
            <p v-if="updateInfo.date" class="text-xs text-[var(--app-muted)] mt-1">Released: {{ new Date(updateInfo.date).toLocaleDateString() }}</p>
            <p v-if="updateInfo.body" class="text-xs text-[var(--app-muted)] mt-2 whitespace-pre-wrap max-h-40 overflow-y-auto">{{ updateInfo.body }}</p>
            <div class="mt-4">
              <Button
                :loading="isDownloading"
                :label="isDownloading ? `Downloading ${downloadProgress}%` : 'Download & Install'"
                @click="handleInstall"
              />
            </div>
            <div v-if="isDownloading" class="mt-3 w-full bg-[color-mix(in_srgb,var(--app-muted)_15%,transparent)] rounded-full h-1.5">
              <div class="h-1.5 rounded-full bg-app-accent transition-all duration-300" :style="{ width: `${downloadProgress}%` }" />
            </div>
          </div>
        </div>
      </div>

      <!-- Up to date -->
      <div v-else-if="!isChecking && !error && lastChecked && !updaterDisabled" class="p-4 rounded-lg bg-green-500/5 border border-green-500/20">
        <div class="flex items-center gap-3">
          <svg class="w-5 h-5 text-green-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" /></svg>
          <span class="text-sm text-[var(--app-foreground)]">You're running the latest version</span>
        </div>
      </div>

      <!-- Auto-check toggle -->
      <div class="flex items-center justify-between mt-4 pt-4 border-t border-[var(--app-border)]">
        <div>
          <p class="text-sm font-medium text-[var(--app-foreground)]">Auto-check for updates</p>
          <p class="text-xs text-[var(--app-muted)]">Check on startup</p>
        </div>
        <Switch v-model="autoCheck" :disabled="updaterDisabled" />
      </div>
    </div>

    <!-- System Info tab -->
    <div v-if="activeTab === 'system'">
      <div class="space-y-0">
        <div class="flex items-center justify-between py-3 border-b border-app">
          <p class="text-sm font-medium text-app">Instance</p>
          <span class="text-sm text-app-muted font-mono">{{ IS_DEV_INSTANCE ? 'Construct DEV' : 'Construct' }}</span>
        </div>
        <div class="flex items-center justify-between py-3 border-b border-app">
          <div>
            <p class="text-sm font-medium text-app">Operator</p>
            <p class="text-xs text-app-muted">AI engine</p>
          </div>
          <span class="px-2 py-0.5 text-[11px] rounded-full" :class="operatorStatus === 'connected' ? 'bg-green-500/10 text-green-500' : operatorStatus === 'checking' ? 'bg-gray-500/10 text-gray-500' : 'bg-red-500/10 text-red-500'">{{ operatorStatus }}</span>
        </div>
        <div class="flex items-center justify-between py-3 border-b border-app">
          <div>
            <p class="text-sm font-medium text-app">Desktop Bridge</p>
            <p class="text-xs text-app-muted">Automation bridge</p>
          </div>
          <span class="px-2 py-0.5 text-[11px] rounded-full" :class="bridgeStatus === 'connected' ? 'bg-green-500/10 text-green-500' : bridgeStatus === 'checking' ? 'bg-gray-500/10 text-gray-500' : 'bg-red-500/10 text-red-500'">{{ bridgeStatus }}</span>
        </div>
        <div v-if="osInfo.platform" class="flex items-center justify-between py-3 border-b border-app">
          <p class="text-sm font-medium text-app">Operating System</p>
          <span class="text-sm text-app-muted font-mono">{{ platformName }} {{ osInfo.version }}</span>
        </div>
        <div v-if="osInfo.arch" class="flex items-center justify-between py-3 border-b border-app">
          <p class="text-sm font-medium text-app">Architecture</p>
          <span class="text-sm text-app-muted font-mono">{{ archName }}</span>
        </div>
        <div v-if="hostname" class="flex items-center justify-between py-3 border-b border-app">
          <p class="text-sm font-medium text-app">Hostname</p>
          <span class="text-sm text-app-muted font-mono">{{ hostname }}</span>
        </div>
        <div v-if="locale" class="flex items-center justify-between py-3 border-b border-app">
          <p class="text-sm font-medium text-app">Locale</p>
          <span class="text-sm text-app-muted font-mono">{{ locale }}</span>
        </div>
        <div v-if="memoryUsage" class="flex items-center justify-between py-3 border-b border-app">
          <p class="text-sm font-medium text-app">Memory (JS Heap)</p>
          <span class="text-sm text-app-muted font-mono">{{ memoryUsage }}</span>
        </div>
        <div v-if="uptime" class="flex items-center justify-between py-3 border-b border-app">
          <p class="text-sm font-medium text-app">Session Uptime</p>
          <span class="text-sm text-app-muted font-mono">{{ uptime }}</span>
        </div>
      </div>
    </div>
  </div>
</template>
