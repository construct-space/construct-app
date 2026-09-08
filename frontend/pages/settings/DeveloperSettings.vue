<script setup lang="ts">
import { Badge, Button, Card, ConfirmationModal, Switch, Tabs, Tab } from '@construct-space/ui'
import { useDevMode } from '@/composables/useDevMode'
import { useAuthStore } from '@/stores/auth'
import { useProjectStore } from '@/stores/project'
import { useProjectDirectory } from '@/composables/useProjectDirectory'
import { detectConstructCli, type ShellCommandResult } from './developerTools'
import { appConfig } from '@/utils/config'

interface RuntimeInfo {
  label: string
  value: string
  status?: 'ok' | 'missing'
  installAction?: () => void
}

const toast = useNotification()
const authStore = useAuthStore()
const { disableUpdates, requestEnrollment, refreshStatus, setDisableUpdates } = useDevMode()
const activeTab = ref<'developer' | 'environment' | 'projects'>('developer')
const enrolling = ref(false)
const refreshing = ref(false)

// `isOrgScope` is still used by the personal-spaces section below to
// enable transfer-to-org actions when the user is operating inside an
// org workspace. Org enrollment itself lives on the Org Developer page.
const isOrgScope = computed(() => authStore.scope === 'org')
const personalDeveloperStatus = computed(() => {
  if (authStore.personalDeveloper) return 'enrolled'
  if (authStore.user?.developer_status === 'pending') return 'pending'
  return 'none'
})
const isPersonalEnrolled = computed(() => personalDeveloperStatus.value === 'enrolled')
const isPersonalEnrollmentPending = computed(() => personalDeveloperStatus.value === 'pending')

async function handleEnroll() {
  enrolling.value = true
  try {
    const result = await requestEnrollment()
    if (result.status === 'enrolled') {
      toast.add({ title: 'Developer access granted', color: 'success' })
      await Promise.all([loadPublisher(), loadPersonalSpaces(), loadPendingTransfers()])
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
  await Promise.all([loadPublisher(), loadPersonalSpaces(), loadPendingTransfers()])
  refreshing.value = false
}

// ── Publisher identity ──
interface PublisherInfo {
  name: string
  kind: string
  api_key: string
  userId?: string
  orgId?: string
}
const publisher = ref<PublisherInfo | null>(null)
const publisherRevealed = ref(false)
const publisherLoading = ref(false)

async function loadPublisher() {
  publisherLoading.value = true
  try {
    const accountsUrl = appConfig.accountsUrl.replace(/\/+$/, '')
    const token = authStore.oauthToken || authStore.token
    if (!token) { publisher.value = null; return }
    const resp = await fetch(`${accountsUrl}/api/developer/auth/cli-verify`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!resp.ok) { publisher.value = null; return }
    const data = await resp.json() as { publishers?: PublisherInfo[] }
    publisher.value = (data.publishers || []).find(p => p.kind === 'user' && p.api_key) ?? null
  } catch {
    publisher.value = null
  } finally {
    publisherLoading.value = false
  }
}

// ── Personal developer cross-section (visible in org context) ──
// When a user has a personal Publisher row but is now operating in org
// scope, the data isn't gone — it just goes invisible because /me/scope
// returns scope='org'. This section surfaces the personal identity so
// the user can either retire it (DELETE /api/enroll/personal — the
// backend refuses if any personal-owned spaces remain) or transfer
// each space to the active org so ownership consolidates cleanly.
interface PersonalSpace {
  name: string
  displayName: string
  status: string
}
const personalSpaces = ref<PersonalSpace[]>([])
const personalSpacesLoaded = ref(false)
const unenrollingPersonal = ref(false)
const unenrollConfirmOpen = ref(false)
const transferTargetSpace = ref<PersonalSpace | null>(null)
const transferring = ref(false)
// spaceName → transferId for the user's pending outgoing transfers.
// Used to flip the per-row button between "Transfer" and "Cancel
// transfer" so a user who already initiated can back out instead of
// accidentally re-firing (the backend cancels-then-recreates on
// re-fire, which is correct but indistinguishable in the UI).
const pendingTransfers = ref<Record<string, number>>({})
const cancelTargetSpace = ref<PersonalSpace | null>(null)
const cancelling = ref(false)

// "Personal spaces" card is rendered when the user is enrolled and has
// a personal Publisher (which they always do once enrolled). Disable +
// transfer-to-org actions are surfaced together so the cleanup workflow
// is one obvious place: clear out spaces, then disable.
const showPersonalSection = computed(() =>
  isPersonalEnrolled.value
)

async function loadPersonalSpaces() {
  if (!authStore.personalDeveloper) {
    personalSpaces.value = []
    personalSpacesLoaded.value = true
    return
  }
  try {
    const accountsUrl = appConfig.accountsUrl.replace(/\/+$/, '')
    const token = authStore.oauthToken || authStore.token
    if (!token) return
    const resp = await fetch(`${accountsUrl}/api/developer/spaces/mine`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!resp.ok) { personalSpaces.value = []; return }
    const data = await resp.json() as {
      spaces?: Array<{ name: string; displayName?: string; status?: string; ownerUserId?: string }>
    }
    // /spaces/mine is filtered server-side by submitted_by; we want
    // currently-owned, so re-filter on ownerUserId. Spaces previously
    // submitted but already transferred drop out here.
    const me = authStore.user?.id
    personalSpaces.value = (data.spaces || [])
      .filter(s => !me || s.ownerUserId === me)
      .map(s => ({
        name: s.name,
        displayName: s.displayName || s.name,
        status: s.status || 'unknown',
      }))
  } catch {
    personalSpaces.value = []
  } finally {
    personalSpacesLoaded.value = true
  }
}

async function handleUnenrollPersonal() {
  unenrollingPersonal.value = true
  try {
    const accountsUrl = appConfig.accountsUrl.replace(/\/+$/, '')
    const token = authStore.oauthToken || authStore.token
    if (!token) return
    const resp = await fetch(`${accountsUrl}/api/developer/enroll/personal`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    })
    if (resp.ok) {
      toast.add({ title: 'Personal developer disabled', color: 'success' })
      unenrollConfirmOpen.value = false
      await authStore.refreshScope()
      await loadPersonalSpaces()
    } else {
      const data = await resp.json().catch(() => ({}))
      // 409 has_spaces means personal still owns spaces — message tells
      // the user to transfer or delete first; the picker right above is
      // the way to do that without leaving the page.
      toast.add({
        title: data.message || data.error || 'Failed to disable personal developer',
        color: 'error',
      })
    }
  } catch {
    toast.add({ title: 'Failed to disable personal developer', color: 'error' })
  } finally {
    unenrollingPersonal.value = false
  }
}

async function loadPendingTransfers() {
  try {
    const accountsUrl = appConfig.accountsUrl.replace(/\/+$/, '')
    const token = authStore.oauthToken || authStore.token
    if (!token) return
    const resp = await fetch(`${accountsUrl}/api/developer/transfers/outgoing`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!resp.ok) { pendingTransfers.value = {}; return }
    const data = await resp.json() as {
      transfers?: Array<{ id: number; status: string; spaceName?: string }>
    }
    const map: Record<string, number> = {}
    for (const t of data.transfers || []) {
      if (t.status === 'pending' && t.spaceName) {
        map[t.spaceName] = t.id
      }
    }
    pendingTransfers.value = map
  } catch {
    pendingTransfers.value = {}
  }
}

async function confirmTransferToOrg() {
  if (!transferTargetSpace.value || !authStore.orgId) return
  transferring.value = true
  try {
    const accountsUrl = appConfig.accountsUrl.replace(/\/+$/, '')
    const token = authStore.oauthToken || authStore.token
    if (!token) return
    const resp = await fetch(
      `${accountsUrl}/api/developer/spaces/${encodeURIComponent(transferTargetSpace.value.name)}/transfers`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ to_org_id: authStore.orgId }),
      },
    )
    if (resp.ok) {
      toast.add({
        title: 'Transfer initiated',
        description: 'An org admin must accept the transfer.',
        color: 'success',
      })
      transferTargetSpace.value = null
      await Promise.all([loadPersonalSpaces(), loadPendingTransfers()])
    } else {
      const data = await resp.json().catch(() => ({}))
      toast.add({
        title: data.error || 'Failed to initiate transfer',
        color: 'error',
      })
    }
  } catch {
    toast.add({ title: 'Failed to initiate transfer', color: 'error' })
  } finally {
    transferring.value = false
  }
}

async function confirmCancelTransfer() {
  if (!cancelTargetSpace.value) return
  const transferId = pendingTransfers.value[cancelTargetSpace.value.name]
  if (!transferId) {
    cancelTargetSpace.value = null
    return
  }
  cancelling.value = true
  try {
    const accountsUrl = appConfig.accountsUrl.replace(/\/+$/, '')
    const token = authStore.oauthToken || authStore.token
    if (!token) return
    const resp = await fetch(`${accountsUrl}/api/developer/transfers/${transferId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    })
    if (resp.ok) {
      toast.add({ title: 'Transfer cancelled', color: 'success' })
      cancelTargetSpace.value = null
      await loadPendingTransfers()
    } else {
      const data = await resp.json().catch(() => ({}))
      toast.add({
        title: data.error || 'Failed to cancel transfer',
        color: 'error',
      })
    }
  } catch {
    toast.add({ title: 'Failed to cancel transfer', color: 'error' })
  } finally {
    cancelling.value = false
  }
}

function maskKey(key: string): string {
  if (!key) return ''
  if (key.length <= 12) return key
  return key.slice(0, 8) + '•'.repeat(20) + key.slice(-4)
}

async function copyPublisherKey() {
  if (!publisher.value?.api_key) return
  try {
    await navigator.clipboard.writeText(publisher.value.api_key)
    toast.add({ title: 'API key copied', color: 'success' })
  } catch {
    toast.add({ title: 'Failed to copy', color: 'error' })
  }
}

function openPortalKeys() {
  const portal = appConfig.accountsUrl.replace(/\/+$/, '')
  window.open(`${portal}/developer/keys`, '_blank', 'noopener')
}
const projectStore = useProjectStore()
const projectDir = useProjectDirectory()

const appVersion = ref('')
const cliInstalling = ref(false)
const cliInstalled = ref(false)
const cliVersion = ref('')
const cliUpdating = ref(false)
const cliUpdateResult = ref<'none' | 'updated' | 'error' | ''>('')
const runtimes = ref<RuntimeInfo[]>([])
const detecting = ref(true)
const installing = ref<string | null>(null)

async function shellCommand(command: string, args: string[]): Promise<ShellCommandResult> {
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
  await Promise.all([checkCli(), detectRuntimes(), loadPublisher(), loadPersonalSpaces(), loadPendingTransfers()])
})

async function checkCli() {
  cliInstalled.value = false
  cliVersion.value = ''
  const detected = await detectConstructCli(shellCommand)
  cliInstalled.value = detected.installed
  cliVersion.value = detected.version
}

async function installCli() {
  cliInstalling.value = true
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    await invoke('install_construct')
    await checkCli()
    if (cliInstalled.value) {
      toast.add({ title: 'Construct CLI installed', color: 'success' })
    } else {
      toast.add({ title: 'CLI install completed but binary not detected — shell reload may be needed', color: 'warning' })
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
    const result = await shellCommand('construct', ['update'])
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

async function installBun() {
  installing.value = 'bun'
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    await invoke('install_bun')
    await detectRuntimes()
    toast.add({ title: 'Bun installed successfully', color: 'success' })
  } catch (e) {
    toast.add({ title: 'Failed to install Bun', description: String(e), color: 'error' })
  } finally { installing.value = null }
}

async function detectRuntimes() {
  detecting.value = true
  const [bun, git, rustc, cargo, go] = await Promise.all([
    shellVersion('bun'), shellVersion('git'),
    shellVersion('rustc'), shellVersion('cargo'), shellVersion('go', ['version']),
  ])
  const items: RuntimeInfo[] = []
  items.push(bun ? { label: 'Bun', value: bun, status: 'ok' } : { label: 'Bun', value: 'Not installed', status: 'missing', installAction: installBun })
  items.push({ label: 'Git', value: git || 'Not installed', status: git ? 'ok' : 'missing' })
  if (rustc) items.push({ label: 'Rust', value: rustc.replace('rustc ', ''), status: 'ok' })
  if (cargo) items.push({ label: 'Cargo', value: cargo.replace('cargo ', ''), status: 'ok' })
  if (go) items.push({ label: 'Go', value: go.match(/go(\d+\.\d+\.\d+)/)?.[1] || go, status: 'ok' })
  runtimes.value = items
  detecting.value = false
}

const cliUpdateLabel = computed(() => {
  if (cliUpdating.value) return 'Checking…'
  if (cliUpdateResult.value === 'none') return 'Up to date'
  if (cliUpdateResult.value === 'updated') return 'Updated!'
  if (cliUpdateResult.value === 'error') return 'Check failed'
  return 'Check for update'
})

const externalProjects = computed(() =>
  projectStore.projects.filter(p => p.is_external)
)
</script>

<template>
  <div class="space-y-4">
    <!-- Enrollment state: not enrolled.
         Personal enrollment only — org enrollment lives on the Org
         Settings → Developer page since it requires org-admin authority
         and creates a different identity (org Publisher row). -->
    <template v-if="!isPersonalEnrolled && !isPersonalEnrollmentPending">
      <Card>
        <template #header>
          <h3 class="text-sm tracking-[0.08em] uppercase font-normal text-[var(--app-foreground)] leading-tight after:content-['.'] after:text-[var(--app-accent)]">Developer access</h3>
          <p class="text-sm text-[var(--app-muted)] mt-2">
            Enroll as a developer to access projects, CLI tools, and space development features.
          </p>
        </template>
        <template #accessory>
          <Button variant="soft" :loading="enrolling" label="Enroll as Developer" @click="handleEnroll" />
        </template>
      </Card>
    </template>

    <!-- Enrollment state: pending -->
    <template v-else-if="!isPersonalEnrolled && isPersonalEnrollmentPending">
      <Card title="Pending review" description="Your developer enrollment is being reviewed. Check back soon.">
        <template #accessory>
          <div class="flex items-center gap-2">
            <Badge color="warning" size="xs">Pending</Badge>
            <Button variant="soft" size="xs" :loading="refreshing" label="Refresh" @click="handleRefresh" />
          </div>
        </template>
      </Card>
    </template>

    <!-- Enabled: tabs + content -->
    <template v-if="isPersonalEnrolled">
      <Tabs v-model="activeTab" variant="segmented">
        <Tab label="Developer" value="developer">
          <div class="space-y-4 mt-4">
            <Card
              title="Space Runner"
              description="Opened automatically by 'construct dev' when developing spaces"
            >
              <template #accessory>
                <Badge color="success" size="xs">Enrolled</Badge>
              </template>
            </Card>

            <Card
              title="Disable Updates"
              description="Skip update checks for local development builds"
            >
              <template #accessory>
                <Switch :model-value="disableUpdates" @update:model-value="setDisableUpdates" />
              </template>
            </Card>

            <!-- Publisher -->
            <Card>
              <template #header>
                <h3 class="text-sm tracking-[0.08em] uppercase font-normal text-[var(--app-foreground)] leading-tight after:content-['.'] after:text-[var(--app-accent)]">Publisher</h3>
                <p class="text-sm text-[var(--app-muted)] mt-0.5">
                  <template v-if="publisher">
                    <span class="font-mono">{{ publisher.name }}</span> — API key synced from my.construct.space
                  </template>
                  <template v-else>
                    Your personal publisher key is not available yet.
                  </template>
                </p>
              </template>
              <template #accessory>
                <Button
                  variant="ghost"
                  size="xs"
                  icon="lucide:external-link"
                  label="Manage on portal"
                  @click="openPortalKeys"
                />
              </template>

              <div v-if="publisher" class="flex items-center gap-2">
                <code class="flex-1 px-3 py-2 rounded-sm text-xs font-mono truncate bg-[var(--app-canvas-bg)] border border-[var(--app-border)] text-[var(--app-foreground)] select-all">
                  {{ publisherRevealed ? publisher.api_key : maskKey(publisher.api_key) }}
                </code>
                <Button
                  variant="soft"
                  size="xs"
                  :icon="publisherRevealed ? 'lucide:eye-off' : 'lucide:eye'"
                  @click="publisherRevealed = !publisherRevealed"
                />
                <Button variant="soft" size="xs" icon="lucide:copy" @click="copyPublisherKey" />
              </div>
              <div v-else-if="!publisherLoading" class="flex items-center gap-2">
                <p class="text-xs text-[var(--app-muted)] flex-1">
                  Try Refresh — syncs from the portal if you enrolled there directly.
                </p>
                <Button
                  variant="soft"
                  size="xs"
                  icon="lucide:key-round"
                  :loading="refreshing"
                  label="Sync key"
                  @click="handleRefresh"
                />
              </div>
            </Card>

            <!-- Construct CLI -->
            <Card>
              <template #header>
                <h3 class="text-sm tracking-[0.08em] uppercase font-normal text-[var(--app-foreground)] leading-tight after:content-['.'] after:text-[var(--app-accent)]">Construct CLI</h3>
                <p class="text-sm text-[var(--app-muted)] mt-0.5">
                  <template v-if="cliInstalled">
                    Installed — <span class="font-mono">{{ cliVersion }}</span>
                  </template>
                  <template v-else>
                    Install via <span class="font-mono">bun</span> — build, dev, and publish spaces
                  </template>
                </p>
              </template>
              <template #accessory>
                <Button
                  v-if="!cliInstalled"
                  variant="soft"
                  :loading="cliInstalling"
                  icon="lucide:terminal"
                  :label="cliInstalling ? 'Installing…' : 'Install CLI'"
                  @click="installCli"
                />
                <Button
                  v-else
                  variant="soft"
                  size="xs"
                  :loading="cliUpdating"
                  :label="cliUpdateLabel"
                  @click="checkForCliUpdate"
                />
              </template>
            </Card>

            <!-- Version -->
            <Card
              title="Version"
              description="Current app version"
            >
              <template #accessory>
                <span class="text-sm text-[var(--app-muted)] font-mono">v{{ appVersion }}</span>
              </template>
            </Card>
          </div>
        </Tab>

        <Tab label="Environment" value="environment">
          <div class="mt-4">
            <div v-if="detecting" class="py-4 text-sm text-[var(--app-muted)]">Detecting runtimes…</div>
            <div v-else class="space-y-3">
              <Card v-for="rt in runtimes" :key="rt.label">
                <template #header>
                  <div class="flex items-center gap-2">
                    <span class="size-2 rounded-full" :class="rt.status === 'ok' ? 'bg-emerald-500' : 'bg-red-400'" />
                    <h3 class="text-sm tracking-[0.08em] uppercase font-normal text-[var(--app-foreground)] leading-tight after:content-['.'] after:text-[var(--app-accent)]">{{ rt.label }}</h3>
                  </div>
                  <p class="text-sm text-[var(--app-muted)] mt-0.5 font-mono">{{ rt.value }}</p>
                </template>
                <template v-if="rt.installAction" #accessory>
                  <Button
                    variant="soft"
                    size="xs"
                    :loading="installing === rt.label.toLowerCase()"
                    label="Install"
                    @click="rt.installAction"
                  />
                </template>
              </Card>
            </div>
          </div>
        </Tab>

        <Tab label="Projects" value="projects">
          <div class="mt-4 space-y-4">
            <Card
              title="Projects Directory"
              description="Root folder where Construct scans for projects"
            >
              <template #accessory>
                <Button
                  variant="soft"
                  size="sm"
                  icon="lucide:folder-open"
                  label="Change"
                  @click="changeProjectsRoot"
                />
              </template>
              <p
                class="text-sm truncate"
                :class="projectStore.projectsRoot
                  ? 'font-mono text-[var(--app-foreground)]'
                  : 'italic text-[var(--app-muted)]'"
              >
                {{ projectStore.projectsRoot || 'Not configured — pick a folder via Change, or open the Projects space' }}
              </p>
            </Card>

            <Card>
              <template #header>
                <h3 class="text-sm tracking-[0.08em] uppercase font-normal text-[var(--app-foreground)] leading-tight after:content-['.'] after:text-[var(--app-accent)]">External Projects</h3>
                <p class="text-sm text-[var(--app-muted)] mt-0.5">Additional folders outside the root to treat as projects</p>
              </template>
              <template #accessory>
                <Button
                  variant="soft"
                  size="xs"
                  icon="lucide:plus"
                  label="Add"
                  @click="addExternalPath"
                />
              </template>

              <div v-if="externalProjects.length === 0" class="text-xs text-[var(--app-muted)]">
                No external project directories added
              </div>
              <div v-else class="space-y-2">
                <div
                  v-for="project in externalProjects"
                  :key="project.id"
                  class="px-3 py-2 rounded-sm border border-[var(--app-border)]"
                >
                  <p class="text-sm font-normal text-[var(--app-foreground)]">{{ project.name }}</p>
                  <p class="text-xs text-[var(--app-muted)] font-mono truncate">{{ project.path }}</p>
                </div>
              </div>
            </Card>
          </div>
        </Tab>
      </Tabs>
    </template>

    <!-- My spaces — manage the user's personal Publisher: list owned
         spaces with optional transfer-to-org actions (enabled only when
         the user is in an org workspace and that org is itself enrolled),
         plus the disable-personal-developer action gated on having
         transferred everything away first. -->
    <Card v-if="showPersonalSection">
      <template #header>
        <h3 class="text-sm tracking-[0.08em] uppercase font-normal text-[var(--app-foreground)] leading-tight after:content-['.'] after:text-[var(--app-accent)]">My spaces</h3>
        <p class="text-sm text-[var(--app-muted)] mt-2">
          Spaces published with your personal API key. Transfer them to an organization to consolidate ownership, or disable personal developer status once the list is empty.
        </p>
      </template>
      <template #accessory>
        <Button
          variant="ghost"
          size="xs"
          color="error"
          :disabled="personalSpaces.length > 0"
          :title="personalSpaces.length > 0 ? 'Transfer or delete your personal spaces first' : ''"
          label="Disable personal developer"
          @click="unenrollConfirmOpen = true"
        />
      </template>

      <div class="space-y-2">
        <p v-if="!personalSpacesLoaded" class="text-xs text-[var(--app-muted)]">Loading personal spaces…</p>
        <p v-else-if="personalSpaces.length === 0" class="text-xs text-[var(--app-muted)]">
          No personal spaces yet. Use the CLI to publish one.
        </p>
        <template v-else>
          <div
            v-for="space in personalSpaces"
            :key="space.name"
            class="flex items-center gap-2 px-3 py-2 rounded-sm bg-[var(--app-canvas-bg)] border border-[var(--app-border)]"
          >
            <div class="flex-1 min-w-0">
              <p class="text-sm text-[var(--app-foreground)] truncate">{{ space.displayName }}</p>
              <p class="text-xs text-[var(--app-muted)] font-mono">{{ space.name }} · {{ space.status }}</p>
            </div>
            <Button
              v-if="pendingTransfers[space.name]"
              variant="ghost"
              size="xs"
              color="warning"
              label="Cancel transfer"
              @click="cancelTargetSpace = space"
            />
            <Button
              v-else-if="isOrgScope"
              variant="soft"
              size="xs"
              :disabled="!authStore.orgDeveloper"
              :title="authStore.orgDeveloper ? '' : `${authStore.orgName || 'The organization'} is not enrolled as a developer yet`"
              :label="`Transfer to ${authStore.orgName || 'org'}`"
              @click="transferTargetSpace = space"
            />
          </div>
        </template>
      </div>
    </Card>

    <ConfirmationModal
      v-model="unenrollConfirmOpen"
      title="Disable personal developer?"
      :message="`Your personal Publisher row will be removed. You can re-enroll later, but spaces you've already published won't return automatically — they'd stay under whoever owns them now.`"
      confirm-text="Disable"
      confirm-color="error"
      :loading="unenrollingPersonal"
      @confirm="handleUnenrollPersonal"
    />

    <ConfirmationModal
      :model-value="transferTargetSpace !== null"
      title="Transfer space to organization?"
      :message="transferTargetSpace
        ? `'${transferTargetSpace.displayName}' will be offered to ${authStore.orgName || 'the organization'}. An org admin must accept before ownership changes.`
        : ''"
      :details="`After acceptance, only the org's API key can publish updates to this space. Re-transfer is locked for 7 days.`"
      confirm-text="Initiate transfer"
      confirm-color="warning"
      :loading="transferring"
      @confirm="confirmTransferToOrg"
      @update:model-value="(v: boolean) => { if (!v) transferTargetSpace = null }"
    />

    <ConfirmationModal
      :model-value="cancelTargetSpace !== null"
      title="Cancel pending transfer?"
      :message="cancelTargetSpace
        ? `Cancel the pending transfer of '${cancelTargetSpace.displayName}' to ${authStore.orgName || 'the organization'}? You'll keep ownership and can re-initiate later.`
        : ''"
      confirm-text="Cancel transfer"
      confirm-color="warning"
      :loading="cancelling"
      @confirm="confirmCancelTransfer"
      @update:model-value="(v: boolean) => { if (!v) cancelTargetSpace = null }"
    />
  </div>
</template>
