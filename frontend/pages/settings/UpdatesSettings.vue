<script setup lang="ts">
import { useUpdater } from '@/composables/useUpdater'
import { useDevMode } from '@/composables/useDevMode'
import Switch from '@/components/ui/Switch.vue'
import Button from '@/components/ui/Button.vue'

const {
  updateAvailable, updateInfo, isChecking, isDownloading, downloadProgress, error,
  checkForUpdates, downloadAndInstall, getAutoCheck, setAutoCheck, getLastChecked,
} = useUpdater()

const { updaterDisabled } = useDevMode()

const appVersion = ref('')
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

onMounted(async () => {
  try {
    const { getVersion } = await import('@tauri-apps/api/app')
    appVersion.value = await getVersion()
  } catch {
    // Fallback to package.json version
    appVersion.value = __APP_VERSION__
  }
  if (!updaterDisabled.value) {
    handleCheck()
  }
})
</script>

<template>
  <div>
    <!-- Current version -->
    <div class="mb-6">
      <div class="border-b border-[var(--app-border)] pb-2 mb-4">
        <h3 class="text-sm font-semibold text-[var(--app-foreground)]">Current Version</h3>
      </div>

      <div class="flex items-center justify-between mb-4">
        <div>
          <p class="text-sm font-medium text-[var(--app-foreground)]">Update Status</p>
          <p v-if="lastChecked" class="text-xs text-[var(--app-muted)]">Last checked: {{ lastChecked.toLocaleString() }}</p>
        </div>
        <Button variant="soft" :loading="isChecking" :disabled="isDownloading || updaterDisabled" label="Check for Updates" @click="handleCheck" />
      </div>

      <div v-if="updaterDisabled" class="p-4 rounded-lg bg-orange-500/5 border border-orange-500/20 mb-4">
        <div class="flex items-start gap-3">
          <svg class="w-5 h-5 text-orange-400 shrink-0 mt-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 9v4" /><path d="M12 17h.01" /><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" /></svg>
          <div>
            <p class="text-sm font-medium text-[var(--app-foreground)]">Updates are disabled in developer mode</p>
            <p class="text-xs text-[var(--app-muted)] mt-1">Disable developer mode in Settings &gt; Developer to re-enable updates.</p>
          </div>
        </div>
      </div>

      <!-- Error -->
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
      <div v-else-if="!isChecking && !error && lastChecked" class="p-4 rounded-lg bg-green-500/5 border border-green-500/20">
        <div class="flex items-center gap-3">
          <svg class="w-5 h-5 text-green-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" /></svg>
          <span class="text-sm text-[var(--app-foreground)]">You're running the latest version<span v-if="appVersion"> (v{{ appVersion }})</span></span>
        </div>
      </div>
    </div>

    <!-- Auto-update -->
    <div class="pt-6 border-t border-[var(--app-border)]">
      <div class="border-b border-[var(--app-border)] pb-2 mb-4">
        <h3 class="text-sm font-semibold text-[var(--app-foreground)]">Auto-Update</h3>
        <p class="text-xs text-[var(--app-muted)]">Configure automatic update behavior</p>
      </div>

      <div class="space-y-4">
        <div class="flex items-center justify-between py-2">
          <div>
            <p class="text-sm font-medium text-[var(--app-foreground)]">Check for updates automatically</p>
            <p class="text-xs text-[var(--app-muted)]">Check for new versions when the app starts</p>
          </div>
          <Switch v-model="autoCheck" :disabled="updaterDisabled" />
        </div>
      </div>
    </div>
  </div>
</template>
