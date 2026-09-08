<script setup lang="ts">
import type { LocalProject } from '@/types/project'
import { invoke } from '@tauri-apps/api/core'
import { useAuthStore } from '@/stores/auth'
import { Upload, CheckCircle, AlertCircle, Loader2 } from 'lucide-vue-next'

const props = defineProps<{
  project: LocalProject | null
}>()

const emit = defineEmits<{
  close: []
}>()

const authStore = useAuthStore()
const isLoggedIn = computed(() => authStore.isAuthenticated)

// Org-private publishing is only valid when the active scope is an
// enrolled org. Personal accounts publish to the public catalog only —
// hide the toggle for them so they don't bother trying.
const canPublishAsOrg = computed(() =>
  authStore.scope === 'org' && authStore.orgDeveloper,
)

const publishing = ref(false)
const published = ref(false)
const error = ref('')
const logs = ref<string[]>([])
const logsContainer = ref<HTMLElement | null>(null)

// Audience choice — three states:
//   'preserve' = no flag, server keeps existing visibility (default on update,
//                public on first publish)
//   'private'  = --private, scope to owning org
//   'public'   = --public, explicit flip from a previously-private space
const audience = ref<'preserve' | 'private' | 'public'>('preserve')

// Space manifest info
const spaceName = ref('')
const spaceVersion = ref('')
const hasUncommitted = ref(false)
const checkingGit = ref(true)

// Absolute path to the directory that actually contains space.manifest.json.
// For legacy single-space projects that's the project root; for project-scope
// layouts it's a `space-<id>/` subdirectory. We resolve this once when the
// modal opens and reuse it for both the manifest read and the CLI invocation.
const spaceDir = ref<string | null>(null)

watch(() => logs.value.length, () => {
  nextTick(() => {
    if (logsContainer.value) {
      logsContainer.value.scrollTop = logsContainer.value.scrollHeight
    }
  })
})

// resolveSpaceDir walks the project to find the directory that actually
// contains space.manifest.json. Returns null when the project isn't a space
// at all. Accepts both layouts Space Developer emits:
//   - single space at the root:  <project>/space.manifest.json
//   - project scope:              <project>/space-<id>/space.manifest.json
// With multiple space-*/ subdirs we pick the first — the modal can grow a
// picker later once that layout is common enough to need one.
async function resolveSpaceDir(projectPath: string): Promise<string | null> {
  const { exists, readDir } = await import('@tauri-apps/plugin-fs')
  if (await exists(`${projectPath}/space.manifest.json`)) return projectPath
  try {
    const entries = await readDir(projectPath)
    for (const entry of entries) {
      if (!entry.isDirectory || !entry.name?.startsWith('space-')) continue
      const candidate = `${projectPath}/${entry.name}`
      if (await exists(`${candidate}/space.manifest.json`)) return candidate
    }
  } catch { /* unreadable project dir — treat as non-space */ }
  return null
}

// Load manifest and git status when modal opens
watch(() => props.project, async (p) => {
  if (!p) return
  publishing.value = false
  published.value = false
  error.value = ''
  logs.value = []
  spaceName.value = ''
  spaceVersion.value = ''
  hasUncommitted.value = false
  checkingGit.value = true
  spaceDir.value = null
  audience.value = 'preserve'

  const path = p.path || p.local_path
  if (!path) return

  // Resolve once; reuse for both the manifest read and the CLI invocation.
  spaceDir.value = await resolveSpaceDir(path)

  if (spaceDir.value) {
    try {
      const { readTextFile } = await import('@tauri-apps/plugin-fs')
      const manifest = JSON.parse(await readTextFile(`${spaceDir.value}/space.manifest.json`))
      spaceName.value = manifest.name || p.name
      spaceVersion.value = manifest.version || '0.0.0'
    } catch {
      spaceName.value = p.name
    }
  } else {
    // No space.manifest.json anywhere — surface it up front so the user
    // doesn't discover it after clicking Publish and watching the CLI fail.
    spaceName.value = p.name
    error.value = 'No space.manifest.json found in this project (checked root and space-*/ subdirs).'
  }

  // Git status check lives at the project root regardless of which
  // subdir the space sits in — dirty-tree warning applies to whatever
  // the user would commit.
  try {
    const result = await invoke<{ success: boolean; stdout: string }>('run_shell_command', {
      command: 'git', args: ['status', '--porcelain'], cwd: path,
    })
    if (result.success && result.stdout.trim().length > 0) {
      hasUncommitted.value = true
    }
  } catch { /* no git */ }
  checkingGit.value = false
}, { immediate: true })

async function handlePublish() {
  if (!props.project || publishing.value) return
  const cwd = spaceDir.value
  if (!cwd) {
    // resolveSpaceDir already surfaced this in error.value when the modal
    // opened; guard here so the button click doesn't silently no-op.
    error.value = 'No space.manifest.json found — nothing to publish.'
    return
  }

  publishing.value = true
  error.value = ''
  logs.value = []

  // Only forward audience flags when the caller is org-enrolled — the CLI
  // also rejects bad combinations server-side, but filtering here keeps a
  // stale UI from sending nonsense.
  const args = ['publish', '--yes']
  if (canPublishAsOrg.value) {
    if (audience.value === 'private') args.push('--private')
    else if (audience.value === 'public') args.push('--public')
    // 'preserve' = send no flag → server keeps existing visibility
  }

  try {
    logs.value.push(`Running construct ${args.join(' ')} (in ${cwd}) ...`)
    const result = await invoke<{ success: boolean; stdout: string; stderr: string }>('run_shell_command', {
      command: 'construct', args, cwd,
    })

    if (result.stdout) {
      for (const line of result.stdout.split('\n').filter(Boolean)) {
        logs.value.push(line)
      }
    }
    if (result.stderr) {
      for (const line of result.stderr.split('\n').filter(Boolean)) {
        logs.value.push(line)
      }
    }

    if (result.success) {
      published.value = true
    } else {
      error.value = 'Publish failed — check logs above'
    }
  } catch (err: unknown) {
    error.value = (err instanceof Error ? err.message : String(err)) || 'Publish failed'
  } finally {
    publishing.value = false
  }
}
</script>

<template>
  <Teleport to="body">
    <div v-if="project" class="fixed inset-0 z-[200] flex items-center justify-center">
      <div class="absolute inset-0 bg-black/50" @click="!publishing && emit('close')" />
      <div class="relative w-full max-w-lg mx-4 rounded-xl border border-[var(--app-border)] bg-[var(--app-background)] shadow-2xl">
        <div class="p-6">
          <!-- Header -->
          <div class="flex items-center gap-3 mb-5">
            <div class="size-10 rounded-lg bg-violet-500/10 flex items-center justify-center">
              <Upload class="size-5 text-violet-400" />
            </div>
            <div>
              <h2 class="text-lg font-semibold text-[var(--app-foreground)]">Publish to Space Store</h2>
              <p class="text-xs text-[var(--app-muted)]">{{ spaceName }}</p>
            </div>
          </div>

          <!-- Not logged in -->
          <div v-if="!isLoggedIn" class="mb-5 p-4 rounded-lg border border-amber-500/30 bg-amber-500/5">
            <p class="text-sm text-amber-400 font-medium mb-1">Login required</p>
            <p class="text-xs text-[var(--app-muted)]">
              Log in to your Construct account to publish spaces.
            </p>
          </div>

          <!-- Publish info (before publish) -->
          <div v-if="!publishing && !published && !error && isLoggedIn" class="space-y-3 mb-5">
            <div class="p-3 rounded-lg bg-[var(--app-surface)] border border-[var(--app-border)]">
              <div class="flex items-center justify-between mb-2">
                <span class="text-xs text-[var(--app-muted)]">Space</span>
                <span class="text-sm font-mono text-[var(--app-foreground)]">{{ spaceName }}</span>
              </div>
              <div class="flex items-center justify-between mb-2">
                <span class="text-xs text-[var(--app-muted)]">Version</span>
                <span class="text-sm font-mono text-violet-400">v{{ spaceVersion }}</span>
              </div>
              <div class="flex items-center justify-between">
                <span class="text-xs text-[var(--app-muted)]">Account</span>
                <span class="text-sm text-[var(--app-foreground)]">{{ authStore.userEmail }}</span>
              </div>
            </div>

            <!-- Audience picker (org-enrolled accounts only) -->
            <div v-if="canPublishAsOrg" class="p-3 rounded-lg bg-[var(--app-surface)] border border-[var(--app-border)]">
              <div class="text-xs text-[var(--app-muted)] uppercase tracking-wider mb-2">Audience</div>
              <div class="space-y-1.5">
                <label class="flex items-start gap-2 cursor-pointer select-none">
                  <input v-model="audience" type="radio" value="preserve"
                    class="mt-0.5 size-3.5 border-[var(--app-border)] bg-transparent text-violet-500 focus:ring-violet-500" />
                  <span>
                    <span class="text-xs text-[var(--app-foreground)] font-medium">Keep current</span>
                    <span class="block text-[11px] text-[var(--app-muted)] leading-snug">
                      First publish defaults to public. Re-publishes keep whatever the space already is.
                    </span>
                  </span>
                </label>
                <label class="flex items-start gap-2 cursor-pointer select-none">
                  <input v-model="audience" type="radio" value="private"
                    class="mt-0.5 size-3.5 border-[var(--app-border)] bg-transparent text-violet-500 focus:ring-violet-500" />
                  <span>
                    <span class="text-xs text-[var(--app-foreground)] font-medium">Org-private</span>
                    <span class="block text-[11px] text-[var(--app-muted)] leading-snug">
                      Only members of {{ authStore.orgName || 'your org' }} see this in the catalog. Oracle staff still review.
                    </span>
                  </span>
                </label>
                <label class="flex items-start gap-2 cursor-pointer select-none">
                  <input v-model="audience" type="radio" value="public"
                    class="mt-0.5 size-3.5 border-[var(--app-border)] bg-transparent text-violet-500 focus:ring-violet-500" />
                  <span>
                    <span class="text-xs text-[var(--app-foreground)] font-medium">Release to public</span>
                    <span class="block text-[11px] text-[var(--app-muted)] leading-snug">
                      Flip a previously-private space back to the public catalog.
                    </span>
                  </span>
                </label>
              </div>
            </div>

            <!-- Uncommitted changes warning -->
            <div v-if="hasUncommitted && !checkingGit" class="flex items-center gap-2 text-xs text-amber-400">
              <span class="size-1.5 rounded-full bg-amber-400" />
              Uncommitted changes — will be included with auto-bump
            </div>
          </div>

          <!-- Logs -->
          <div v-if="logs.length > 0" class="mb-5">
            <div
              ref="logsContainer"
              class="p-3 rounded-lg bg-black/40 border border-[var(--app-border)] max-h-48 overflow-y-auto font-mono text-xs space-y-0.5"
            >
              <div
                v-for="(log, i) in logs"
                :key="i"
                class="text-[var(--app-muted)]"
                :class="{ 'text-violet-400': log.includes('Published'), 'text-red-400': log.includes('Error') || log.includes('failed') }"
              >
                {{ log }}
              </div>
            </div>
          </div>

          <!-- Success -->
          <div v-if="published" class="mb-5 p-4 rounded-lg border border-violet-500/30 bg-violet-500/5">
            <div class="flex items-center gap-2">
              <CheckCircle class="size-4 text-violet-400" />
              <p class="text-sm text-violet-400 font-medium">Published!</p>
            </div>
          </div>

          <!-- Error -->
          <div v-if="error" class="mb-5 p-4 rounded-lg border border-red-500/30 bg-red-500/5">
            <div class="flex items-center gap-2 mb-1">
              <AlertCircle class="size-4 text-red-400" />
              <p class="text-sm text-red-400 font-medium">Publish failed</p>
            </div>
            <p class="text-xs text-red-400/80">{{ error }}</p>
          </div>

          <!-- Actions -->
          <div class="flex justify-end gap-3">
            <button
              class="px-4 py-2 rounded-lg border border-[var(--app-border)] text-sm text-[var(--app-foreground)] hover:bg-[var(--app-muted)]/5 transition-colors"
              :disabled="publishing"
              @click="emit('close')"
            >
              {{ published ? 'Close' : 'Cancel' }}
            </button>
            <button
              v-if="!published"
              class="px-4 py-2 rounded-lg bg-violet-500 text-white text-sm font-medium hover:bg-violet-600 transition-colors disabled:opacity-50 flex items-center gap-2"
              :disabled="publishing || !isLoggedIn"
              @click="handlePublish"
            >
              <Loader2 v-if="publishing" class="size-4 animate-spin" />
              <Upload v-else class="size-4" />
              {{ publishing ? 'Publishing...' : 'Publish' }}
            </button>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>
