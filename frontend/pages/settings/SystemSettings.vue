<script setup lang="ts">
/**
 * SystemSettings — System info and runtime environment
 */
import Button from '@/components/ui/Button.vue'
import { IS_DEV_INSTANCE } from '@/lib/appPaths'
import { useOperator } from '@/operator'

const activeTab = ref<'system' | 'environment'>('system')
const operator = useOperator()

interface RuntimeInfo {
  label: string
  value: string
  status?: 'ok' | 'missing'
  installAction?: () => void
}

const toast = useToast()

const appVersion = ref('')
const operatorVersion = ref('')
const operatorLatestVersion = ref('')
const operatorUpdateAvailable = ref(false)
const operatorChecking = ref(false)
const operatorUpdating = ref(false)
const osInfo = ref('')
const runtimes = ref<RuntimeInfo[]>([])
const installing = ref<string | null>(null)
const detecting = ref(true)

async function shellVersion(command: string, args: string[] = ['--version']): Promise<string> {
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    const result = await invoke<{ success: boolean; stdout: string }>('run_shell_command', {
      command,
      args,
      cwd: '/',
    })
    return result.success ? result.stdout.trim() : ''
  } catch {
    return ''
  }
}

async function installBun() {
  installing.value = 'bun'
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    await invoke('run_shell_command', {
      command: 'bash',
      args: ['-c', 'curl -fsSL https://bun.sh/install | bash'],
      cwd: '/',
    })
    await detectRuntimes()
    const toast = useToast()
    toast.add({ title: 'Bun installed successfully', color: 'success' })
  } catch {
    const toast = useToast()
    toast.add({ title: 'Failed to install Bun', color: 'error' })
  } finally {
    installing.value = null
  }
}

async function checkOperatorUpdate() {
  operatorChecking.value = true
  try {
    const result = await operator.send<{
      current_version?: string
      latest_version?: string
      update_available?: boolean
    }>('system.check_update', {})
    if (result?.latest_version) operatorLatestVersion.value = result.latest_version
    operatorUpdateAvailable.value = !!result?.update_available
    if (!result?.update_available) {
      toast.add({ title: 'Operator is up to date', color: 'success' })
    }
  } catch {
    toast.add({ title: 'Failed to check for operator updates', color: 'error' })
  } finally {
    operatorChecking.value = false
  }
}

async function applyOperatorUpdate() {
  operatorUpdating.value = true
  try {
    const result = await operator.send<{
      updated?: boolean
      new_version?: string
      restart_required?: boolean
    }>('system.apply_update', {})
    if (result?.updated) {
      operatorVersion.value = result.new_version || operatorLatestVersion.value
      operatorUpdateAvailable.value = false
      toast.add({ title: `Operator updated to v${operatorVersion.value}`, description: result.restart_required ? 'Restart the app to use the new version.' : undefined, color: 'success' })
    } else {
      toast.add({ title: 'Operator is already up to date', color: 'info' })
    }
  } catch {
    toast.add({ title: 'Failed to update operator', color: 'error' })
  } finally {
    operatorUpdating.value = false
  }
}

async function detectRuntimes() {
  detecting.value = true
  const [bun, node, npm, pnpm, yarn, git, rustc, cargo, go] = await Promise.all([
    shellVersion('bun'),
    shellVersion('node'),
    shellVersion('npm'),
    shellVersion('pnpm'),
    shellVersion('yarn'),
    shellVersion('git'),
    shellVersion('rustc'),
    shellVersion('cargo'),
    shellVersion('go', ['version']),
  ])

  const items: RuntimeInfo[] = []

  if (bun) {
    items.push({ label: 'Bun', value: bun, status: 'ok' })
  } else {
    items.push({ label: 'Bun', value: 'Not installed', status: 'missing', installAction: installBun })
  }

  items.push({ label: 'Node.js', value: node || 'Not installed', status: node ? 'ok' : 'missing' })
  items.push({ label: 'npm', value: npm || 'Not installed', status: npm ? 'ok' : 'missing' })

  if (pnpm) items.push({ label: 'pnpm', value: pnpm, status: 'ok' })
  if (yarn) items.push({ label: 'Yarn', value: yarn, status: 'ok' })

  items.push({ label: 'Git', value: git || 'Not installed', status: git ? 'ok' : 'missing' })
  if (rustc) items.push({ label: 'Rust', value: rustc.replace('rustc ', ''), status: 'ok' })
  if (cargo) items.push({ label: 'Cargo', value: cargo.replace('cargo ', ''), status: 'ok' })
  if (go) {
    const ver = go.match(/go(\d+\.\d+\.\d+)/)?.[1] || go
    items.push({ label: 'Go', value: ver, status: 'ok' })
  }

  runtimes.value = items
  detecting.value = false
}

onMounted(async () => {
  try {
    const { getVersion } = await import('@tauri-apps/api/app')
    appVersion.value = await getVersion()
  } catch {
    appVersion.value = __APP_VERSION__
  }

  try {
    const result = await operator.send<{ version?: string }>('system.info', {})
    if (result?.version) operatorVersion.value = result.version
  } catch { /* operator may not be running */ }

  try {
    const { platform, arch, version: osVersion } = await import('@tauri-apps/plugin-os')
    osInfo.value = `${platform()} ${arch()} (${osVersion()})`
  } catch { /* web context */ }

  await detectRuntimes()
})
</script>

<template>
  <div>
    <!-- Tabs -->
    <div class="flex gap-1 p-1 bg-[color-mix(in_srgb,var(--app-muted)_8%,transparent)] rounded-lg w-fit mb-6">
      <button
        class="px-4 py-1.5 text-sm rounded-md transition-colors cursor-pointer"
        :class="activeTab === 'system' ? 'bg-app-accent text-white' : 'text-[var(--app-muted)] hover:text-[var(--app-foreground)]'"
        @click="activeTab = 'system'"
      >
        System
      </button>
      <button
        class="px-4 py-1.5 text-sm rounded-md transition-colors cursor-pointer"
        :class="activeTab === 'environment' ? 'bg-app-accent text-white' : 'text-[var(--app-muted)] hover:text-[var(--app-foreground)]'"
        @click="activeTab = 'environment'"
      >
        Environment
      </button>
    </div>

    <!-- System Tab -->
    <template v-if="activeTab === 'system'">
      <div class="space-y-4">
        <div class="flex items-center justify-between py-3 border-b border-app">
          <p class="text-sm font-medium text-app">App Version</p>
          <span class="text-sm text-app-muted font-mono">v{{ appVersion }}</span>
        </div>
        <div v-if="operatorVersion" class="flex items-center justify-between py-3 border-b border-app">
          <div>
            <p class="text-sm font-medium text-app">Operator Version</p>
            <p v-if="operatorUpdateAvailable" class="text-xs text-app-accent mt-0.5">v{{ operatorLatestVersion }} available</p>
          </div>
          <div class="flex items-center gap-3">
            <span class="text-sm text-app-muted font-mono">v{{ operatorVersion }}</span>
            <Button
              v-if="operatorUpdateAvailable"
              variant="soft"
              size="xs"
              :loading="operatorUpdating"
              label="Update"
              @click="applyOperatorUpdate"
            />
            <Button
              v-else
              variant="ghost"
              size="xs"
              :loading="operatorChecking"
              label="Check"
              @click="checkOperatorUpdate"
            />
          </div>
        </div>
        <div class="flex items-center justify-between py-3 border-b border-app">
          <p class="text-sm font-medium text-app">Instance</p>
          <span class="text-sm text-app-muted font-mono">{{ IS_DEV_INSTANCE ? 'Construct DEV' : 'Construct' }}</span>
        </div>
        <div v-if="osInfo" class="flex items-center justify-between py-3 border-b border-app">
          <p class="text-sm font-medium text-app">OS</p>
          <span class="text-sm text-app-muted font-mono">{{ osInfo }}</span>
        </div>
      </div>
    </template>

    <!-- Environment Tab -->
    <template v-else-if="activeTab === 'environment'">
      <div v-if="detecting" class="text-sm text-app-muted py-4">Detecting runtimes...</div>
      <div v-else class="space-y-4">
        <div
          v-for="rt in runtimes"
          :key="rt.label"
          class="flex items-center justify-between py-3 border-b border-app"
        >
          <div class="flex items-center gap-2">
            <span
              class="size-2 rounded-full"
              :class="rt.status === 'ok' ? 'bg-green-500' : 'bg-red-400'"
            />
            <p class="text-sm font-medium text-app">{{ rt.label }}</p>
          </div>
          <div class="flex items-center gap-3">
            <span class="text-sm text-app-muted font-mono">{{ rt.value }}</span>
            <Button
              v-if="rt.installAction"
              variant="soft"
              size="xs"
              :loading="installing === rt.label.toLowerCase()"
              label="Install"
              @click="rt.installAction"
            />
          </div>
        </div>
      </div>
    </template>
  </div>
</template>
