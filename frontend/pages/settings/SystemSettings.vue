<script setup lang="ts">
/**
 * SystemSettings — System info, updates & diagnostics
 */
import { Shield, ShieldAlert, ShieldBan, ShieldOff } from 'lucide-vue-next'
import { useUpdater } from '@/composables/useUpdater'
import { useDevMode } from '@/composables/useDevMode'
import { useBrain } from '@/brain'
import { normalizePermissionMode, type PermissionModeValue } from '@/brain/types'
import { Alert, Badge, Button, Card, Switch, Tabs, Tab } from '@construct-space/ui'

// ── System info ──
const appVersion = ref('')
const osInfo = ref({ platform: '', arch: '', version: '' })
const hostname = ref('')
const locale = ref('')
const brain = useBrain()
const bridgeStatus = ref<'checking' | 'connected' | 'unreachable' | 'disabled'>('checking')
const brainStatus = ref<'checking' | 'connected' | 'unreachable'>('checking')
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

  try {
    const info = await brain.info() as { bridgeStatus?: string }
    brainStatus.value = 'connected'
    bridgeStatus.value = (info?.bridgeStatus as 'connected' | 'unreachable' | 'disabled') || 'unreachable'
  } catch {
    brainStatus.value = 'unreachable'
    bridgeStatus.value = 'unreachable'
  }

  if ((performance as unknown as { memory?: { usedJSHeapSize: number } }).memory) {
    const mem = (performance as unknown as { memory: { usedJSHeapSize: number } }).memory
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

const activeTab = ref<'updates' | 'permissions' | 'system'>('updates')

// ── Permissions ──
const PERMISSION_MODE_KEY = 'brain.permission.mode'
const ALWAYS_ALLOW_KEY = 'brain.permission.always_allow'

const permissionModes: { value: PermissionModeValue; label: string; desc: string; icon: typeof Shield; color: string }[] = [
  { value: 'default', label: 'Default', desc: 'Safe tools run automatically; no prompts.', icon: Shield, color: 'text-[var(--app-muted)]' },
  { value: 'ask', label: 'Ask', desc: 'Prompt before any tool that writes, edits, runs shell, or invokes a space action.', icon: ShieldAlert, color: 'text-amber-400' },
  { value: 'strict', label: 'Strict', desc: 'Auto-deny all mutating tools. Read-only assistance only.', icon: ShieldBan, color: 'text-red-400' },
  { value: 'yolo', label: 'YOLO', desc: 'Allow every tool, including destructive ones, with no gating. Use with care.', icon: ShieldOff, color: 'text-orange-400' },
]

const permissionMode = ref<PermissionModeValue>('default')
const alwaysAllowList = ref<string[]>([])

function loadAlwaysAllow(): string[] {
  try {
    const raw = localStorage.getItem(ALWAYS_ALLOW_KEY)
    if (!raw) return []
    const arr = JSON.parse(raw)
    return Array.isArray(arr) ? arr.filter((x) => typeof x === 'string') : []
  } catch {
    return []
  }
}

function saveAlwaysAllow(list: string[]) {
  try {
    localStorage.setItem(ALWAYS_ALLOW_KEY, JSON.stringify(list))
  } catch { /* quota / private mode */ }
  alwaysAllowList.value = list
}

function removeAlwaysAllow(tool: string) {
  saveAlwaysAllow(alwaysAllowList.value.filter((t) => t !== tool))
}

function clearAlwaysAllow() {
  saveAlwaysAllow([])
}

async function selectPermissionMode(mode: PermissionModeValue) {
  permissionMode.value = mode
  try {
    localStorage.setItem(PERMISSION_MODE_KEY, mode)
  } catch { /* ignore */ }
  try {
    await brain.request('coder.set_permission_mode', { mode })
  } catch { /* brain may be offline */ }
}

onMounted(() => {
  permissionMode.value = normalizePermissionMode(localStorage.getItem(PERMISSION_MODE_KEY))
  alwaysAllowList.value = loadAlwaysAllow()
})

const platformName = computed(() => {
  // @tauri-apps/plugin-os returns: 'linux' | 'macos' | 'windows' | 'ios' | 'android'
  const names: Record<string, string> = { macos: 'macOS', windows: 'Windows', linux: 'Linux', ios: 'iOS', android: 'Android' }
  return names[osInfo.value.platform] || osInfo.value.platform
})

const archName = computed(() => {
  const arch = osInfo.value.arch
  const platform = osInfo.value.platform
  if (arch === 'aarch64') {
    if (platform === 'macos') return 'Apple Silicon (arm64)'
    if (platform === 'windows') return 'Windows on ARM (arm64)'
    if (platform === 'linux') return 'Linux ARM64 (aarch64)'
    return 'ARM64 (aarch64)'
  }
  if (arch === 'x86_64') {
    if (platform === 'windows' || platform === 'linux') return 'x86_64'
    return 'Intel (x86_64)'
  }
  return arch
})

const statusColor = (s: string): 'success' | 'error' | 'warning' | 'neutral' => {
  if (s === 'connected') return 'success'
  if (s === 'checking') return 'neutral'
  if (s === 'disabled') return 'warning'
  return 'error'
}

const infoRows = computed(() => {
  const rows: Array<{ label: string; value: string }> = [
    { label: 'Instance', value: 'Construct' },
  ]
  if (osInfo.value.platform) rows.push({ label: 'Operating System', value: `${platformName.value} ${osInfo.value.version}` })
  if (osInfo.value.arch) rows.push({ label: 'Architecture', value: archName.value })
  if (hostname.value) rows.push({ label: 'Hostname', value: hostname.value })
  if (locale.value) rows.push({ label: 'Locale', value: locale.value })
  if (memoryUsage.value) rows.push({ label: 'Memory (JS Heap)', value: memoryUsage.value })
  if (uptime.value) rows.push({ label: 'Session Uptime', value: uptime.value })
  return rows
})
</script>

<template>
  <div class="space-y-4">
    <Tabs v-model="activeTab" variant="segmented">
      <!-- Updates tab -->
      <Tab label="Updates" value="updates">
        <div class="space-y-4 mt-4">
          <!-- Current version + check button -->
          <Card
            :title="`Construct v${appVersion || '—'}`"
            :description="lastChecked ? `Last checked: ${lastChecked.toLocaleString()}` : 'Not checked yet'"
          >
            <template #accessory>
              <Button
                variant="soft"
                :loading="isChecking"
                :disabled="isDownloading || updaterDisabled"
                label="Check for Updates"
                @click="handleCheck"
              />
            </template>
          </Card>

          <!-- Updater disabled warning -->
          <Alert
            v-if="updaterDisabled"
            color="warning"
            title="Updates disabled in developer mode"
            description="Disable developer mode in Settings > Developer to re-enable."
          />

          <!-- Error -->
          <Alert
            v-if="error && !isChecking"
            color="error"
            title="Update check failed"
            :description="error"
          />

          <!-- Update available -->
          <Card v-if="updateAvailable && updateInfo" :title="`Update Available: v${updateInfo.version}`">
            <div class="space-y-3">
              <p v-if="updateInfo.date" class="text-xs text-[var(--app-muted)]">
                Released: {{ new Date(updateInfo.date).toLocaleDateString() }}
              </p>
              <p v-if="updateInfo.body" class="text-xs text-[var(--app-muted)] whitespace-pre-wrap max-h-40 overflow-y-auto">
                {{ updateInfo.body }}
              </p>
              <Button
                :loading="isDownloading"
                :label="isDownloading ? `Downloading ${downloadProgress}%` : 'Download & Install'"
                @click="handleInstall"
              />
              <div
                v-if="isDownloading"
                class="w-full bg-[color-mix(in_srgb,var(--app-muted)_15%,transparent)] rounded-sm h-1"
              >
                <div
                  class="h-1 rounded-sm bg-app-accent transition-all duration-300"
                  :style="{ width: `${downloadProgress}%` }"
                />
              </div>
            </div>
          </Card>

          <!-- Up to date -->
          <Alert
            v-else-if="!isChecking && !error && lastChecked && !updaterDisabled"
            color="success"
            description="You're running the latest version"
          />

          <!-- Auto-check toggle -->
          <Card
            title="Auto-check for updates"
            description="Check on startup"
          >
            <template #accessory>
              <Switch v-model="autoCheck" :disabled="updaterDisabled" />
            </template>
          </Card>
        </div>
      </Tab>

      <!-- Permissions tab -->
      <Tab label="Permissions" value="permissions">
        <div class="space-y-4 mt-4">
          <Card
            title="Permission mode"
            description="Controls how the assistant handles tools that modify your project (write, edit, bash, space actions)."
          >
            <div class="space-y-2 mt-3">
              <button
                v-for="m in permissionModes"
                :key="m.value"
                class="flex items-start gap-3 w-full p-3 rounded-lg border text-left transition-colors"
                :class="permissionMode === m.value
                  ? 'border-[var(--app-accent)] bg-[color-mix(in_srgb,var(--app-accent)_8%,transparent)]'
                  : 'border-[var(--app-border)] hover:bg-[color-mix(in_srgb,var(--app-foreground)_4%,transparent)]'"
                @click="selectPermissionMode(m.value)"
              >
                <component :is="m.icon" class="size-4 mt-0.5 shrink-0" :class="m.color" />
                <div class="min-w-0 flex-1">
                  <div class="text-sm font-medium text-[var(--app-foreground)]">{{ m.label }}</div>
                  <div class="text-xs text-[var(--app-muted)] mt-0.5">{{ m.desc }}</div>
                </div>
                <div
                  v-if="permissionMode === m.value"
                  class="size-2 rounded-full bg-[var(--app-accent)] mt-1.5 shrink-0"
                />
              </button>
            </div>
          </Card>

          <Card
            title="Always-allowed tools"
            :description="alwaysAllowList.length
              ? `${alwaysAllowList.length} tool${alwaysAllowList.length === 1 ? '' : 's'} skip the permission prompt in Ask mode.`
              : 'Tools you mark as “Always allow” in the permission prompt appear here.'"
          >
            <template v-if="alwaysAllowList.length" #accessory>
              <Button variant="soft" size="sm" label="Clear all" @click="clearAlwaysAllow" />
            </template>
            <div v-if="alwaysAllowList.length" class="mt-3 space-y-1">
              <div
                v-for="tool in alwaysAllowList"
                :key="tool"
                class="flex items-center justify-between px-3 py-2 rounded-md bg-[color-mix(in_srgb,var(--app-foreground)_3%,transparent)]"
              >
                <span class="text-xs font-mono text-[var(--app-foreground)]">{{ tool }}</span>
                <Button variant="ghost" size="xs" label="Remove" @click="removeAlwaysAllow(tool)" />
              </div>
            </div>
          </Card>
        </div>
      </Tab>

      <!-- System Info tab -->
      <Tab label="System Info" value="system">
        <Card class="mt-4">
          <div class="space-y-3">
            <!-- Services -->
            <div class="flex items-center justify-between">
              <div>
                <p class="text-sm font-normal text-[var(--app-foreground)]">Brain</p>
                <p class="text-xs text-[var(--app-muted)]">AI engine</p>
              </div>
              <Badge :color="statusColor(brainStatus)" size="xs">{{ brainStatus }}</Badge>
            </div>

            <div class="flex items-center justify-between">
              <div>
                <p class="text-sm font-normal text-[var(--app-foreground)]">Desktop Bridge</p>
                <p class="text-xs text-[var(--app-muted)]">Automation bridge</p>
              </div>
              <Badge :color="statusColor(bridgeStatus)" size="xs">{{ bridgeStatus }}</Badge>
            </div>

            <!-- Divider -->
            <div class="h-px bg-[var(--app-border)] my-1" />

            <!-- Key/value rows -->
            <div
              v-for="row in infoRows"
              :key="row.label"
              class="flex items-center justify-between"
            >
              <span class="text-[11px] tracking-[0.08em] uppercase text-[var(--app-muted)]">{{ row.label }}</span>
              <span class="text-sm text-[var(--app-foreground)] font-mono">{{ row.value }}</span>
            </div>
          </div>
        </Card>
      </Tab>
    </Tabs>
  </div>
</template>
