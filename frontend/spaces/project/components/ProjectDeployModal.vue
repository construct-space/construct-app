<script setup lang="ts">
import type { LocalProject } from '@/types/project'
import { invoke } from '@tauri-apps/api/core'
import { useBasepodDeploy } from '@/composables/useBasepodDeploy'
import { useAuthStore } from '@/stores/auth'
import { Rocket, CheckCircle, AlertCircle, ExternalLink, Loader2 } from 'lucide-vue-next'

const props = defineProps<{
  project: LocalProject | null
}>()

const emit = defineEmits<{
  close: []
}>()

const authStore = useAuthStore()
const { state, deploy, generateAppName } = useBasepodDeploy()

const isLoggedIn = computed(() => authStore.isAuthenticated)
const appName = computed(() => props.project ? generateAppName(props.project.name) : '')
const expectedUrl = computed(() => `https://${appName.value}.construct.ninja`)

const deployMessage = ref('')
const logsContainer = ref<HTMLElement | null>(null)

watch(() => state.value.logs.length, () => {
  nextTick(() => {
    if (logsContainer.value) {
      logsContainer.value.scrollTop = logsContainer.value.scrollHeight
    }
  })
})

const hasUncommitted = ref(false)
const checkingGit = ref(true)

// Check for uncommitted changes when modal opens
watch(() => props.project, async (p) => {
  if (!p) return
  checkingGit.value = true
  hasUncommitted.value = false
  deployMessage.value = ''
  const codePath = p.path || p.local_path
  if (!codePath) return
  try {
    // Check code/ subdirectory if it exists
    const tauriFs = await import('@tauri-apps/plugin-fs')
    const sourceDir = await tauriFs.exists(`${codePath}/code`) ? `${codePath}/code` : codePath
    const result = await invoke<{ success: boolean; stdout: string }>('run_shell_command', {
      command: 'git', args: ['status', '--porcelain'], cwd: sourceDir,
    })
    if (result.success && result.stdout.trim().length > 0) {
      hasUncommitted.value = true
    }
  } catch { /* no git */ }
  checkingGit.value = false
}, { immediate: true })

async function handleDeploy() {
  if (!props.project) return
  const path = props.project.path || props.project.local_path
  if (!path) return

  // If there are uncommitted changes and user provided a message, commit first
  if (hasUncommitted.value && deployMessage.value.trim()) {
    try {
      const tauriFs = await import('@tauri-apps/plugin-fs')
      const sourceDir = await tauriFs.exists(`${path}/code`) ? `${path}/code` : path
      await invoke('run_shell_command', {
        command: 'sh',
        args: ['-c', `git add -A && git commit -m "${deployMessage.value.trim().replace(/"/g, '\\"')}"`],
        cwd: sourceDir,
      })
    } catch { /* commit failed — deploy anyway */ }
  }

  await deploy(path, props.project.name)
}

async function openUrl(url: string) {
  try {
    const { open } = await import('@tauri-apps/plugin-shell')
    await open(url)
  } catch {
    window.open(url, '_blank')
  }
}
</script>

<template>
  <Teleport to="body">
    <div v-if="project" class="fixed inset-0 z-[200] flex items-center justify-center">
      <div class="absolute inset-0 bg-black/50" @click="!state.deploying && emit('close')" />
      <div class="relative w-full max-w-lg mx-4 rounded-xl border border-[var(--app-border)] bg-[var(--app-background)] shadow-2xl">
        <div class="p-6">
          <!-- Header -->
          <div class="flex items-center gap-3 mb-5">
            <div class="size-10 rounded-lg bg-emerald-500/10 flex items-center justify-center">
              <Rocket class="size-5 text-emerald-400" />
            </div>
            <div>
              <h2 class="text-lg font-semibold text-[var(--app-foreground)]">Deploy to construct.ninja</h2>
              <p class="text-xs text-[var(--app-muted)]">{{ project.name }}</p>
            </div>
          </div>

          <!-- Not logged in -->
          <div v-if="!isLoggedIn" class="mb-5 p-4 rounded-lg border border-amber-500/30 bg-amber-500/5">
            <p class="text-sm text-amber-400 font-medium mb-1">Login required</p>
            <p class="text-xs text-[var(--app-muted)]">
              Log in to your Construct account to deploy projects for free.
            </p>
          </div>

          <!-- Deploy info (before deploy) -->
          <div v-if="!state.deploying && !state.url && !state.error && isLoggedIn" class="space-y-3 mb-5">
            <div class="p-3 rounded-lg bg-[var(--app-surface)] border border-[var(--app-border)]">
              <div class="flex items-center justify-between mb-2">
                <span class="text-xs text-[var(--app-muted)]">App name</span>
                <span class="text-sm font-mono text-[var(--app-foreground)]">{{ appName }}</span>
              </div>
              <div class="flex items-center justify-between mb-2">
                <span class="text-xs text-[var(--app-muted)]">URL</span>
                <span class="text-sm font-mono text-emerald-400">{{ expectedUrl }}</span>
              </div>
              <div class="flex items-center justify-between">
                <span class="text-xs text-[var(--app-muted)]">Account</span>
                <span class="text-sm text-[var(--app-foreground)]">{{ authStore.userEmail }}</span>
              </div>
            </div>

            <!-- Commit message (only if uncommitted changes) -->
            <div v-if="hasUncommitted && !checkingGit" class="space-y-1.5">
              <label class="flex items-center gap-2 text-xs font-medium text-amber-400">
                <span class="size-1.5 rounded-full bg-amber-400" />
                Uncommitted changes detected
              </label>
              <input
                v-model="deployMessage"
                type="text"
                placeholder="Describe your changes (will commit before deploy)"
                class="w-full px-3 py-2 rounded-lg border border-[var(--app-border)] bg-[var(--app-surface)] text-sm text-[var(--app-foreground)] placeholder:text-[var(--app-muted)]/50 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500"
                @keydown.enter="handleDeploy"
              />
            </div>
          </div>

          <!-- Deploy logs -->
          <div v-if="state.logs.length > 0" class="mb-5">
            <div
              ref="logsContainer"
              class="p-3 rounded-lg bg-black/40 border border-[var(--app-border)] max-h-48 overflow-y-auto font-mono text-xs space-y-0.5"
            >
              <div
                v-for="(log, i) in state.logs"
                :key="i"
                class="text-[var(--app-muted)]"
                :class="{ 'text-emerald-400': log.startsWith('Live at:'), 'text-red-400': log.startsWith('Error:') }"
              >
                {{ log }}
              </div>
            </div>
          </div>

          <!-- Success state -->
          <div v-if="state.url" class="mb-5 p-4 rounded-lg border border-emerald-500/30 bg-emerald-500/5">
            <div class="flex items-center gap-2 mb-2">
              <CheckCircle class="size-4 text-emerald-400" />
              <p class="text-sm text-emerald-400 font-medium">Deployed!</p>
            </div>
            <button
              class="text-sm text-emerald-400 hover:text-emerald-300 underline font-mono"
              @click="openUrl(state.url!)"
            >
              {{ state.url }}
            </button>
          </div>

          <!-- Error state -->
          <div v-if="state.error" class="mb-5 p-4 rounded-lg border border-red-500/30 bg-red-500/5">
            <div class="flex items-center gap-2 mb-1">
              <AlertCircle class="size-4 text-red-400" />
              <p class="text-sm text-red-400 font-medium">Deploy failed</p>
            </div>
            <p class="text-xs text-red-400/80">{{ state.error }}</p>
          </div>

          <!-- Actions -->
          <div class="flex justify-end gap-3">
            <button
              class="px-4 py-2 rounded-lg border border-[var(--app-border)] text-sm text-[var(--app-foreground)] hover:bg-[var(--app-muted)]/5 transition-colors"
              :disabled="state.deploying"
              @click="emit('close')"
            >
              {{ state.url ? 'Close' : 'Cancel' }}
            </button>
            <button
              v-if="!state.url"
              class="px-4 py-2 rounded-lg bg-emerald-500 text-white text-sm font-medium hover:bg-emerald-600 transition-colors disabled:opacity-50 flex items-center gap-2"
              :disabled="state.deploying || !isLoggedIn"
              @click="handleDeploy"
            >
              <Loader2 v-if="state.deploying" class="size-4 animate-spin" />
              <Rocket v-else class="size-4" />
              {{ state.deploying ? 'Deploying...' : 'Deploy' }}
            </button>
            <button
              v-if="state.url"
              class="px-4 py-2 rounded-lg bg-emerald-500 text-white text-sm font-medium hover:bg-emerald-600 transition-colors flex items-center gap-2"
              @click="openUrl(state.url!)"
            >
              <ExternalLink class="size-4" />
              Open in Browser
            </button>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>
