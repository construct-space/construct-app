<script setup lang="ts">
import Button from '@/components/ui/Button.vue'
import Switch from '@/components/ui/Switch.vue'
import { useDevMode } from '@/composables/useDevMode'
import { ExternalLink, Terminal, Check, Loader2 } from 'lucide-vue-next'

const toast = useToast()
const { disableUpdates } = useDevMode()

const appVersion = ref('')
const cliInstalling = ref(false)
const cliInstalled = ref(false)
const cliVersion = ref('')
const cliUpdating = ref(false)
const cliUpdateResult = ref<'none' | 'updated' | 'error' | ''>('')
const detectedPM = ref<{ name: string; installArgs: string[] } | null>(null)

// PM install commands in preference order
const PM_CONFIGS = [
  { name: 'bun', command: 'bun', installArgs: ['install', '-g', '@construct-space/cli@latest'] },
  { name: 'npm', command: 'npm', installArgs: ['install', '-g', '@construct-space/cli@latest'] },
  { name: 'pnpm', command: 'pnpm', installArgs: ['add', '-g', '@construct-space/cli@latest'] },
  { name: 'yarn', command: 'yarn', installArgs: ['global', 'add', '@construct-space/cli@latest'] },
  { name: 'deno', command: 'deno', installArgs: ['install', '-g', 'npm:@construct-space/cli@latest'] },
]

async function shellCommand(command: string, args: string[]): Promise<{ success: boolean; stdout: string; stderr: string }> {
  const { invoke } = await import('@tauri-apps/api/core')
  return invoke('run_shell_command', { command, args, cwd: '/' })
}

onMounted(async () => {
  try {
    const { getVersion } = await import('@tauri-apps/api/app')
    appVersion.value = await getVersion()
  } catch {
    appVersion.value = __APP_VERSION__
  }
  await Promise.all([checkCli(), detectPreferredPM()])
})

async function detectPreferredPM() {
  for (const pm of PM_CONFIGS) {
    try {
      const result = await shellCommand(pm.command, ['--version'])
      if (result.success && result.stdout.trim()) {
        detectedPM.value = { name: pm.name, installArgs: pm.installArgs }
        return
      }
    } catch { /* not installed */ }
  }
}

async function checkCli() {
  const candidates = [
    { cmd: 'construct', args: ['version'] },
    { cmd: 'sh', args: ['-c', 'export PATH="$HOME/.bun/bin:$HOME/.nvm/versions/node/$(ls $HOME/.nvm/versions/node 2>/dev/null | tail -1)/bin:/usr/local/bin:/opt/homebrew/bin:$PATH" && construct version'] },
  ]
  for (const { cmd, args } of candidates) {
    try {
      const result = await shellCommand(cmd, args)
      if (result.success && result.stdout.trim()) {
        cliInstalled.value = true
        cliVersion.value = result.stdout.trim().split('\n').pop()?.trim() || result.stdout.trim()
        return
      }
    } catch { /* try next */ }
  }
}

async function installCli() {
  if (!detectedPM.value) {
    toast.add({ title: 'No package manager found', description: 'Install bun, npm, pnpm, or yarn first (see System > Environment)', color: 'error' })
    return
  }

  cliInstalling.value = true
  try {
    const pm = detectedPM.value
    const result = await shellCommand(pm.name, pm.installArgs)
    if (result.success) {
      cliInstalled.value = true
      toast.add({ title: `Construct CLI installed via ${pm.name}`, color: 'success' })
      await checkCli()
    } else {
      toast.add({ title: 'Failed to install CLI', description: result.stderr || result.stdout, color: 'error' })
    }
  } catch (error) {
    toast.add({ title: 'Failed to install CLI', description: String(error), color: 'error' })
  } finally {
    cliInstalling.value = false
  }
}

async function checkForCliUpdate() {
  cliUpdating.value = true
  cliUpdateResult.value = ''
  try {
    const oldVersion = cliVersion.value
    const result = await shellCommand('sh', ['-c', 'export PATH="$HOME/.bun/bin:$HOME/.nvm/versions/node/$(ls $HOME/.nvm/versions/node 2>/dev/null | tail -1)/bin:/usr/local/bin:/opt/homebrew/bin:$PATH" && construct update'])
    if (result.success) {
      await checkCli()
      if (cliVersion.value !== oldVersion && oldVersion) {
        cliUpdateResult.value = 'updated'
        toast.add({ title: `CLI updated to ${cliVersion.value}`, color: 'success' })
      } else {
        cliUpdateResult.value = 'none'
        toast.add({ title: 'CLI is up to date', color: 'info' })
      }
    } else {
      cliUpdateResult.value = 'error'
      toast.add({ title: 'Update failed', description: result.stderr || result.stdout, color: 'error' })
    }
  } catch (error) {
    cliUpdateResult.value = 'error'
    toast.add({ title: 'Update failed', description: String(error), color: 'error' })
  } finally {
    cliUpdating.value = false
    setTimeout(() => { cliUpdateResult.value = '' }, 5000)
  }
}

async function handleRunConstructDev() {
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    await invoke('open_construct_dev')
  } catch (error) {
    toast.add({
      title: 'Construct DEV not available',
      description: String(error || 'Build Construct DEV first with tauri:build:devmode'),
      color: 'warning',
    })
  }
}
</script>

<template>
  <div class="space-y-8">
    <div>
      <h2 class="text-lg font-semibold text-app mb-1">Developer</h2>
      <p class="text-sm text-app-muted">Tools for space development and testing</p>
    </div>

    <div class="space-y-4">
      <div class="flex items-center justify-between py-3 border-b border-app">
        <div>
          <p class="text-sm font-medium text-app">Construct DEV</p>
          <p class="text-xs text-app-muted">Spawn an isolated dev instance to test spaces</p>
        </div>
        <Button variant="soft" @click="handleRunConstructDev">
          <ExternalLink class="size-3.5 mr-1.5" />
          Run Construct Dev
        </Button>
      </div>

      <div class="flex items-center justify-between py-3 border-b border-app">
        <div>
          <p class="text-sm font-medium text-app">Disable Updates</p>
          <p class="text-xs text-app-muted">Skip update checks for local development builds</p>
        </div>
        <Switch v-model="disableUpdates" />
      </div>

      <div class="flex items-center justify-between py-3 border-b border-app">
        <div>
          <p class="text-sm font-medium text-app">Construct CLI</p>
          <p class="text-xs text-app-muted">
            <template v-if="cliInstalled">
              Installed — <span class="font-mono">{{ cliVersion }}</span>
            </template>
            <template v-else-if="detectedPM">
              Install via <span class="font-mono">{{ detectedPM.name }}</span> — build, dev, and publish spaces from the terminal
            </template>
            <template v-else>
              No package manager found — install bun, npm, or pnpm first
            </template>
          </p>
        </div>
        <Button v-if="!cliInstalled" variant="soft" :disabled="cliInstalling || !detectedPM" @click="installCli">
          <Loader2 v-if="cliInstalling" class="size-3.5 mr-1.5 animate-spin" />
          <Terminal v-else class="size-3.5 mr-1.5" />
          {{ cliInstalling ? 'Installing...' : 'Install CLI' }}
        </Button>
        <div v-else class="flex items-center gap-2">
          <Check class="size-4 text-green-500" />
          <Button
            variant="soft"
            size="xs"
            :disabled="cliUpdating"
            @click="checkForCliUpdate"
          >
            <Loader2 v-if="cliUpdating" class="size-3 mr-1 animate-spin" />
            <template v-if="cliUpdating">Checking...</template>
            <template v-else-if="cliUpdateResult === 'none'">Up to date</template>
            <template v-else-if="cliUpdateResult === 'updated'">Updated!</template>
            <template v-else>Check for update</template>
          </Button>
        </div>
      </div>

      <div class="flex items-center justify-between py-3 border-b border-app">
        <div>
          <p class="text-sm font-medium text-app">Version</p>
          <p class="text-xs text-app-muted">Current app version</p>
        </div>
        <span class="text-sm text-app-muted font-mono">v{{ appVersion }}</span>
      </div>
    </div>
  </div>
</template>
