<script setup lang="ts">
/**
 * ProjectDetailPage - Project overview with spaces, stats, and deploy
 */
import { computed } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useProjectStore } from '@/stores/project'
import { getSpace } from '@/config/spaces'
import { routeParamString } from '@/utils/projectRoutes'
import { useProjectSummary } from '../composables/useProjectSummary'
import { useBasepodDeploy } from '@/composables/useBasepodDeploy'
import { useOperator } from '@/operator'
import { Rocket, Zap, ExternalLink, FolderTree, FileText, GitBranch, Globe, Calendar, Layers, Loader2, Folder, File, X, DraftingCompass } from 'lucide-vue-next'
import { useMarkdown } from '@/composables/useMarkdown'
import ProjectDeployModal from '../components/ProjectDeployModal.vue'

const { renderMarkdown } = useMarkdown()
const operator = useOperator()

// Doc preview modal
const previewDoc = ref<{ title: string; content: string } | null>(null)

async function openDoc(docTitle: string) {
  const path = projectPath.value
  if (!path) return
  // Find the actual filename from the docs folder
  const fileName = summary.value.docs.items.find((d: { title: string }) => d.title === docTitle)
  if (!fileName) return
  const filePath = `${path}/docs/${docTitle.replace(/ /g, '-')}.md`
  try {
    const result = await operator.callTool({
      id: `doc-${Date.now()}`,
      type: 'function',
      function: { name: 'read_file', arguments: JSON.stringify({ path: filePath }) },
    })
    if (result?.content) {
      const content = String(result.content).replace(/^\s*\d+[│|]\s?/gm, '')
      previewDoc.value = { title: docTitle, content }
    }
  } catch { /* ignore */ }
}

const router = useRouter()
const route = useRoute()
const projectStore = useProjectStore()
const { loadDeployInfo } = useBasepodDeploy()

const project = computed(() => projectStore.currentProject)
const projectRouteKey = computed(() => routeParamString(route.params.projectId))
const projectPath = computed(() => project.value?.path || project.value?.local_path)
const { summary } = useProjectSummary(projectPath)

const showDeployModal = ref(false)
const deployInfo = ref<{ name: string; url: string; domain: string; deployed_at: string } | null>(null)

watchEffect(async () => {
  if (projectPath.value) {
    deployInfo.value = await loadDeployInfo(projectPath.value)
  }
})

function enterSpace(spaceName: string) {
  if (projectRouteKey.value) {
    router.push(`/app/projects/${projectRouteKey.value}/${spaceName}`)
  }
}

async function openDeployedSite() {
  if (!deployInfo.value?.url) return
  try {
    const { open } = await import('@tauri-apps/plugin-shell')
    await open(deployInfo.value.url)
  } catch {
    window.open(deployInfo.value.url, '_blank')
  }
}

async function onDeployClose() {
  showDeployModal.value = false
  if (projectPath.value) {
    deployInfo.value = await loadDeployInfo(projectPath.value)
  }
}

const formatDate = (dateStr: string) => {
  try {
    const d = new Date(dateStr)
    return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
  } catch {
    return dateStr
  }
}

const extLabel: Record<string, string> = {
  ts: 'TypeScript', js: 'JavaScript', vue: 'Vue', tsx: 'TSX', jsx: 'JSX',
  go: 'Go', rs: 'Rust', py: 'Python', rb: 'Ruby', swift: 'Swift',
  dart: 'Dart', kt: 'Kotlin', java: 'Java', css: 'CSS', scss: 'SCSS',
  html: 'HTML', json: 'JSON', yaml: 'YAML', yml: 'YAML', toml: 'TOML',
  md: 'Markdown', sql: 'SQL', sh: 'Shell', svg: 'SVG',
}

function getExtLabel(ext: string): string {
  return extLabel[ext] || `.${ext}`
}
</script>

<template>
  <div class="h-full overflow-auto">
    <div v-if="projectStore.loading" class="flex items-center justify-center h-full">
      <Loader2 class="size-5 animate-spin text-[var(--app-muted)]" />
    </div>

    <div v-else-if="project" class="max-w-3xl mx-auto px-8 py-16">
      <!-- Project name -->
      <p class="text-xs text-[var(--app-muted)] uppercase tracking-widest font-medium mb-2">Project</p>
      <h1 class="text-4xl font-bold text-[var(--app-foreground)] mb-2">{{ project.name }}</h1>
      <p v-if="project.description" class="text-lg text-[var(--app-muted)] font-light mb-1">
        {{ project.description }}
      </p>
      <p class="text-xs text-[var(--app-muted)]/60 font-mono mb-8">{{ project.path }}</p>

      <!-- Deploy banner (if deployed) -->
      <div
        v-if="deployInfo"
        class="flex items-center justify-between p-4 rounded-xl border border-emerald-500/30 bg-emerald-500/5 mb-8 cursor-pointer hover:border-emerald-400/50 transition-colors"
        @click="openDeployedSite"
      >
        <div class="flex items-center gap-3">
          <span class="size-2 rounded-full bg-emerald-400 animate-pulse" />
          <span class="text-sm font-medium text-emerald-400">Live</span>
          <span class="text-sm text-[var(--app-muted)] font-mono">{{ deployInfo.domain }}</span>
        </div>
        <div class="flex items-center gap-3">
          <span class="text-xs text-[var(--app-muted)]">{{ formatDate(deployInfo.deployed_at) }}</span>
          <ExternalLink class="size-3.5 text-emerald-400" />
        </div>
      </div>

      <!-- Action buttons -->
      <div class="flex items-center gap-3 mb-12">
        <button
          class="inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition-colors"
          :class="deployInfo
            ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/20'
            : 'bg-emerald-500 text-white hover:bg-emerald-600'"
          @click="showDeployModal = true"
        >
          <Rocket class="size-4" />
          {{ deployInfo ? 'Re-Deploy' : 'Deploy' }}
        </button>
        <button
          class="inline-flex items-center gap-2 rounded-full border border-[var(--app-border)] px-4 py-2 text-sm font-medium text-[var(--app-foreground)] transition-colors hover:border-amber-400/40 hover:bg-amber-400/10"
          @click="enterSpace('vibe')"
        >
          <Zap class="size-4 text-amber-400" />
          Open Vibe
        </button>
        <button
          class="inline-flex items-center gap-2 rounded-full border border-[var(--app-border)] px-4 py-2 text-sm font-medium text-[var(--app-foreground)] transition-colors hover:border-blue-400/40 hover:bg-blue-400/10"
          @click="enterSpace('architect')"
        >
          <DraftingCompass class="size-4 text-blue-400" />
          Architect
        </button>
      </div>

      <!-- Overview: two columns -->
      <div v-if="summary.loading" class="mb-12">
        <div class="h-32 rounded-lg bg-[color-mix(in_srgb,var(--app-foreground)_2%,transparent)] animate-pulse" />
      </div>
      <div v-else class="grid grid-cols-1 lg:grid-cols-3 gap-8 mb-12">
        <!-- Left: README + docs -->
        <div class="lg:col-span-2 min-w-0">
          <template v-if="summary.readme">
            <div class="project-prose text-sm leading-relaxed prose prose-sm dark:prose-invert max-w-none mb-8"
              v-html="renderMarkdown(summary.readme)" />
          </template>

        </div>

        <!-- Right: docs + file tree + stats -->
        <div class="space-y-6">
          <!-- Docs -->
          <div v-if="summary.docs.count > 0">
            <p class="text-xs text-[var(--app-muted)] uppercase tracking-wider font-medium mb-2">Docs</p>
            <div class="space-y-0.5">
              <button
                v-for="doc in summary.docs.items"
                :key="doc.title"
                class="flex items-center gap-2 w-full py-1 text-xs text-left rounded hover:bg-[color-mix(in_srgb,var(--app-foreground)_3%,transparent)] transition-colors cursor-pointer px-1"
                @click="openDoc(doc.title)"
              >
                <FileText class="size-3.5 text-violet-400 shrink-0" />
                <span class="text-[var(--app-foreground)] truncate">{{ doc.title }}</span>
              </button>
            </div>
          </div>

          <!-- Git -->
          <div v-if="summary.git.hasRepo" class="flex items-center gap-2 text-sm">
            <GitBranch class="size-3.5 text-orange-400" />
            <span class="text-[var(--app-foreground)]">{{ summary.git.branch || 'main' }}</span>
          </div>

          <!-- File stats -->
          <div v-if="summary.files.count > 0">
            <div class="flex items-center gap-2 mb-2">
              <FolderTree class="size-3.5 text-blue-400" />
              <span class="text-xs text-[var(--app-muted)] uppercase tracking-wider font-medium">{{ summary.files.count }} files</span>
            </div>
            <div v-if="summary.files.languages.length" class="flex flex-wrap gap-1.5">
              <span
                v-for="lang in summary.files.languages.slice(0, 6)"
                :key="lang.ext"
                class="text-[10px] px-1.5 py-0.5 rounded bg-[color-mix(in_srgb,var(--app-foreground)_5%,transparent)] text-[var(--app-muted)]"
              >{{ getExtLabel(lang.ext) }} · {{ lang.count }}</span>
            </div>
          </div>

          <!-- File list -->
          <div v-if="summary.fileTree.length > 0">
            <p class="text-xs text-[var(--app-muted)] uppercase tracking-wider font-medium mb-2">Files</p>
            <div class="space-y-0.5">
              <div
                v-for="file in summary.fileTree"
                :key="file.name"
                class="flex items-center gap-2 py-0.5 text-xs"
              >
                <Folder v-if="file.type === 'directory'" class="size-3.5 text-amber-400 shrink-0" />
                <File v-else class="size-3.5 text-[var(--app-muted)] shrink-0" />
                <span :class="file.type === 'directory' ? 'text-[var(--app-foreground)] font-medium' : 'text-[var(--app-muted)]'">{{ file.name }}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div v-else class="flex items-center justify-center h-full">
      <p class="text-sm text-[var(--app-muted)]">Project not found</p>
    </div>

    <ProjectDeployModal
      :project="showDeployModal ? project : null"
      @close="onDeployClose"
    />

    <!-- Doc preview modal -->
    <Teleport to="body">
      <Transition name="fade">
        <div v-if="previewDoc" class="fixed inset-0 z-50 flex items-center justify-center p-8">
          <div class="absolute inset-0 bg-black/60" @click="previewDoc = null" />
          <div class="relative w-full max-w-3xl max-h-[80vh] rounded-xl border border-[var(--app-border)] bg-[var(--app-background)] shadow-2xl flex flex-col overflow-hidden">
            <div class="flex items-center justify-between px-5 py-3 border-b border-[var(--app-border)] shrink-0">
              <h3 class="text-sm font-semibold text-[var(--app-foreground)]">{{ previewDoc.title }}</h3>
              <button class="text-[var(--app-muted)] hover:text-[var(--app-foreground)] transition-colors" @click="previewDoc = null">
                <X class="size-4" />
              </button>
            </div>
            <div class="flex-1 overflow-auto px-6 py-5">
              <div class="project-prose text-sm leading-relaxed prose prose-sm dark:prose-invert max-w-none"
                v-html="renderMarkdown(previewDoc.content)" />
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<style scoped>
.fade-enter-active, .fade-leave-active { transition: opacity 0.15s ease; }
.fade-enter-from, .fade-leave-to { opacity: 0; }

.project-prose {
  --tw-prose-body: var(--app-foreground);
  --tw-prose-headings: var(--app-foreground);
  --tw-prose-bold: var(--app-foreground);
  --tw-prose-links: var(--app-accent);
  --tw-prose-code: var(--app-foreground);
}
</style>
