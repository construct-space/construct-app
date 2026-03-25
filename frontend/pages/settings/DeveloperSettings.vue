<script setup lang="ts">
import { Button, Switch, Tabs, Tab } from '@construct-space/ui'
import { useDevMode } from '@/composables/useDevMode'
import { useProjectStore } from '@/stores/project'
import { useProjectDirectory } from '@/composables/useProjectDirectory'
import { ExternalLink, Terminal, Check, Loader2, FolderOpen } from 'lucide-vue-next'

interface RuntimeInfo {
  label: string
  value: string
  status?: 'ok' | 'missing'
  installAction?: () => void
}

const toast = useNotification()
const { isDeveloperMode, isEnrollmentPending, isEnrolled, developerStatus, disableUpdates, requestEnrollment, refreshStatus, setDisableUpdates } = useDevMode()
const activeTab = ref<'developer' | 'environment' | 'projects'>('developer')
const enrolling = ref(false)
const refreshing = ref(false)

async function handleEnroll() {
  enrolling.value = true
  try {
    const result = await requestEnrollment()
    if (result.status === 'enrolled') {
      toast.add({ title: 'Developer access granted', color: 'success' })
    } else if (result.status === 'pending') {
      toast.add({ title: 'Enrollment submitted', description: 'Your request is being reviewed', color: 'info' })
    } else {
      toast.add({ title: result.message || 'Enrollment failed', color: 'error' })
    }
  } catch {
    toast.add({ title: 'Failed to enroll', color: 'error' })
  } finally {
    enrolling.value = false
  }
}

async function handleRefresh() {
  refreshing.value = true
  await refreshStatus()
  refreshing.value = false
}
const projectStore = useProjectStore()
const projectDir = useProjectDirectory()

const appVersion = ref('')
const cliInstalling = ref(false)
const cliInstalled = ref(false)
const cliVersion = ref('')
const cliUpdating = ref(false)
const cliUpdateResult = ref<'none' | 'updated' | 'error' | ''>('')
const detectedPM = ref<{ name: string; installArgs: string[] } | null>(null)
const runtimes = ref<RuntimeInfo[]>([])
const detecting = ref(true)
const installing = ref<string | null>(null)

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

async function shellVersion(command: string, args: string[] = ['--version']): Promise<string> {
  try {
    const result = await shellCommand(command, args)
    return result.success ? result.stdout.trim() : ''
  } catch { return '' }
}

onMounted(async () => {
  try {
    const { getVersion } = await import('@tauri-apps/api/app')
    appVersion.value = await getVersion()
  } catch { appVersion.value = __APP_VERSION__ }
  await Promise.all([checkCli(), detectPreferredPM(), detectRuntimes()])
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
  if (!detectedPM.value) return
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
  } finally { cliInstalling.value = false }
}

async function checkForCliUpdate() {
  cliUpdating.value = true
  cliUpdateResult.value = ''
  try {
    const oldVersion = cliVersion.value
    const result = await shellCommand('sh', ['-c', 'export PATH="$HOME/.bun/bin:$HOME/.nvm/versions/node/$(ls $HOME/.nvm/versions/node 2>/dev/null | tail -1)/bin:/usr/local/bin:/opt/homebrew/bin:$PATH" && construct update'])
    if (result.success) {
      await checkCli()
      cliUpdateResult.value = (cliVersion.value !== oldVersion && oldVersion) ? 'updated' : 'none'
    } else { cliUpdateResult.value = 'error' }
  } catch { cliUpdateResult.value = 'error' }
  finally { cliUpdating.value = false; setTimeout(() => { cliUpdateResult.value = '' }, 5000) }
}

async function changeProjectsRoot() {
  const path = await projectDir.openFolderDialog('Choose Projects Folder')
  if (path) {
    await projectDir.setProjectsRoot(path)
    projectStore.projectsRoot = path
    toast.add({ title: 'Projects directory updated', color: 'success' })
  }
}

async function addExternalPath() {
  const path = await projectDir.openFolderDialog('Add External Project')
  if (path) {
    await projectStore.addExternalFolderByPath(path)
    toast.add({ title: 'External project added', color: 'success' })
  }
}

async function handleRunConstructDev() {
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    await invoke('open_construct_dev')
  } catch (error) {
    toast.add({ title: 'Construct DEV not available', description: String(error), color: 'warning' })
  }
}

// ── Environment (runtimes) ──

async function installBun() {
  installing.value = 'bun'
  try {
    await shellCommand('bash', ['-c', 'curl -fsSL https://bun.sh/install | bash'])
    await detectRuntimes()
    toast.add({ title: 'Bun installed successfully', color: 'success' })
  } catch {
    toast.add({ title: 'Failed to install Bun', color: 'error' })
  } finally { installing.value = null }
}

async function detectRuntimes() {
  detecting.value = true
  const [bun, node, npm, pnpm, yarn, git, rustc, cargo, go] = await Promise.all([
    shellVersion('bun'), shellVersion('node'), shellVersion('npm'),
    shellVersion('pnpm'), shellVersion('yarn'), shellVersion('git'),
    shellVersion('rustc'), shellVersion('cargo'), shellVersion('go', ['version']),
  ])
  const items: RuntimeInfo[] = []
  items.push(bun ? { label: 'Bun', value: bun, status: 'ok' } : { label: 'Bun', value: 'Not installed', status: 'missing', installAction: installBun })
  items.push({ label: 'Node.js', value: node || 'Not installed', status: node ? 'ok' : 'missing' })
  items.push({ label: 'npm', value: npm || 'Not installed', status: npm ? 'ok' : 'missing' })
  if (pnpm) items.push({ label: 'pnpm', value: pnpm, status: 'ok' })
  if (yarn) items.push({ label: 'Yarn', value: yarn, status: 'ok' })
  items.push({ label: 'Git', value: git || 'Not installed', status: git ? 'ok' : 'missing' })
  if (rustc) items.push({ label: 'Rust', value: rustc.replace('rustc ', ''), status: 'ok' })
  if (cargo) items.push({ label: 'Cargo', value: cargo.replace('cargo ', ''), status: 'ok' })
  if (go) items.push({ label: 'Go', value: go.match(/go(\d+\.\d+\.\d+)/)?.[1] || go, status: 'ok' })
  runtimes.value = items
  detecting.value = false
}

</script>

<template>
  <div class="space-y-6">
    <!-- Header with enrollment status -->
    <div class="flex items-center justify-between">
      <div>
        <h2 class="text-lg font-semibold text-app mb-1">Developer</h2>
        <p class="text-sm text-app-muted">Tools for space development and testing</p>
      </div>
      <div v-if="isDeveloperMode" class="flex items-center gap-2">
        <span class="text-xs font-medium px-2 py-0.5 rounded-full bg-green-500/15 text-green-500">Enrolled</span>
      </div>
      <div v-else-if="isEnrollmentPending" class="flex items-center gap-2">
        <span class="text-xs font-medium px-2 py-0.5 rounded-full bg-yellow-500/15 text-yellow-500">Pending
          Review</span>
        <Button variant="soft" size="xs" :loading="refreshing" label="Refresh" @click="handleRefresh" />
      </div>
      <Button v-else variant="soft" :loading="enrolling" label="Enroll as Developer" @click="handleEnroll" />
    </div>

    <!-- Not enrolled -->
    <div v-if="!isDeveloperMode && !isEnrollmentPending" class="py-8 text-center">
      <p class="text-sm text-[var(--app-muted)] mb-2">
        Enroll as a developer to access projects, CLI tools, and space
        development features.
      </p>
      <p class="text-xs text-[var(--app-muted)]">
        Your account must be approved before developer tools become available.
      </p>
    </div>

    <!-- Pending -->
    <div v-else-if="!isDeveloperMode && isEnrollmentPending" class="py-8 text-center">
      <p class="text-sm text-[var(--app-muted)]">Your developer enrollment is being reviewed. Check back soon.</p>
    </div>

    <!-- Enabled: tabs + content -->
    <template v-if="isDeveloperMode">
      <Tabs v-model="activeTab" variant="segmented">
        <Tab label="Developer" value="developer">
          <div class="space-y-0">
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
            <Switch :modelValue="disableUpdates" @update:modelValue="setDisableUpdates" />
          </div>

          <div class="flex items-center justify-between py-3 border-b border-app">
            <div>
              <p class="text-sm font-medium text-app">Construct CLI</p>
              <p class="text-xs text-app-muted">
                <template v-if="cliInstalled">Installed — <span class="font-mono">{{ cliVersion }}</span></template>
                <template v-else-if="detectedPM">
                  Install via <span class="font-mono">{{ detectedPM.name }}</span> —
                  build, dev, and publish spaces
                </template>
                <template v-else>No package manager found</template>
              </p>
            </div>
            <Button v-if="!cliInstalled" variant="soft" :disabled="cliInstalling || !detectedPM" @click="installCli">
              <Loader2 v-if="cliInstalling" class="size-3.5 mr-1.5 animate-spin" />
              <Terminal v-else class="size-3.5 mr-1.5" />
              {{ cliInstalling ? 'Installing...' : 'Install CLI' }}
            </Button>
            <div v-else class="flex items-center gap-2">
              <Check class="size-4 text-green-500" />
              <Button variant="soft" size="xs" :disabled="cliUpdating" @click="checkForCliUpdate">
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
        </Tab>

        <Tab label="Environment" value="environment">
          <div v-if="detecting" class="py-4 text-sm text-app-muted">Detecting runtimes...</div>
          <div v-else class="space-y-0">
          <div v-for="rt in runtimes" :key="rt.label"
            class="flex items-center justify-between py-3 border-b border-app">
            <div class="flex items-center gap-2">
              <span class="size-2 rounded-full" :class="rt.status === 'ok' ? 'bg-green-500' : 'bg-red-400'" />
              <p class="text-sm font-medium text-app">{{ rt.label }}</p>
            </div>
            <div class="flex items-center gap-3">
              <span class="text-sm text-app-muted font-mono">{{ rt.value }}</span>
              <Button v-if="rt.installAction" variant="soft" size="xs" :loading="installing === rt.label.toLowerCase()"
                label="Install" @click="rt.installAction" />
            </div>
          </div>
          </div>
        </Tab>

        <Tab label="Projects" value="projects">
          <div>
          <div class="flex items-center gap-3 mb-4">
            <div
              class="flex-1 px-3 py-2.5 rounded-lg border border-[var(--app-border)] bg-[var(--app-background)] text-sm text-[var(--app-foreground)] font-mono truncate">
              {{ projectStore.projectsRoot || '~/ConstructProjects' }}
            </div>
            <Button variant="soft" size="sm" @click="changeProjectsRoot">
              <FolderOpen class="size-3.5 mr-1.5" />
              Change
            </Button>
          </div>

          <div class="flex items-center justify-between mb-3">
            <p class="text-xs text-[var(--app-muted)] uppercase tracking-widest">External Projects</p>
            <button class="text-xs text-app-accent hover:underline" @click="addExternalPath">+ Add</button>
          </div>

          <div v-if="projectStore.projects.filter(p => p.is_external).length === 0"
            class="text-xs text-[var(--app-muted)]">
            No external project directories added
          </div>
          <div v-else class="space-y-2">
            <div v-for="project in projectStore.projects.filter(p => p.is_external)" :key="project.id"
              class="p-3 rounded-lg border border-[var(--app-border)] text-sm">
              <p class="font-medium text-[var(--app-foreground)]">{{ project.name }}</p>
              <p class="text-xs text-[var(--app-muted)] font-mono truncate">{{ project.path }}</p>
            </div>
          </div>
          </div>
        </Tab>
      </Tabs>
    </template>
  </div>
</template>
