<script setup lang="ts">
/**
 * Architect Space — describe a project, agent writes docs.
 *
 * Flow: User describes → Architect writes docs to project/docs/ → "Open Project" button.
 * No questions step, no plan JSON, no templates, no scaffolding.
 * Architect ONLY writes markdown docs. Coder writes code.
 */
import { ref, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAgentSession, type RequestBlock } from '@/operator/useAgentSession'
import { useProjectStore } from '@/stores/project'
import { useProjectSummary } from '@/spaces/project/composables/useProjectSummary'
import { DraftingCompass, FileText, Folder, File } from 'lucide-vue-next'
import AgentView from '@/components/agent/AgentView.vue'
import AgentInput from '@/components/agent/AgentInput.vue'

defineProps<{
  mode?: string
}>()

const route = useRoute()
const router = useRouter()
const projectStore = useProjectStore()
const projectsRoot = computed(() => projectStore.projectsRoot || '/Users/flakerim/ConstructProjects')

const session = useAgentSession()
const { turns, isLoading, statusMessage } = session

// Project context
const currentProject = computed(() => projectStore.currentProject)
const projectPath = computed(() => {
  if (currentProject.value?.local_path) return currentProject.value.local_path
  return ''
})

const hasProject = computed(() => !!projectPath.value)
const { summary } = useProjectSummary(projectPath)

const inputPlaceholder = computed(() => {
  if (turns.value.length > 0) return 'Continue or refine...'
  if (projectPath.value) return 'What do you want to add or change?'
  return 'Describe what you want to build...'
})

// Detect if docs were written
const docsWritten = computed(() =>
  turns.value.some(turn =>
    turn.response.some(b =>
      b.type === 'tool' && b.tool === 'write_file' && b.state === 'done'
    )
  )
)

// Extract project path from tool calls (architect creates the dir)
const detectedProjectPath = computed(() => {
  for (const turn of turns.value) {
    for (const block of turn.response) {
      if (block.type === 'tool' && block.tool === 'bash' && block.input) {
        const match = block.input.match(/mkdir.*?([~/][^\s"']+\/docs)/)
        if (match) return match[1].replace(/\/docs$/, '')
      }
      if (block.type === 'tool' && block.tool === 'write_file' && block.input) {
        const match = block.input.match(/"path"\s*:\s*"([^"]+\/docs\/[^"]+)"/)
        if (match) return match[1].replace(/\/docs\/.*$/, '')
      }
    }
  }
  return ''
})

function handleQuestionAnswer(_questionId: string, answer: string) {
  handleSend([{ type: 'text', content: answer }])
}

async function handleSend(blocks: RequestBlock[]) {
  const text = blocks
    .filter(b => b.type === 'text')
    .map(b => b.content)
    .join('\n')
  if (!text.trim()) return

  // Build task with project context — but keep original blocks for display
  const path = projectPath.value || detectedProjectPath.value
  let taskOverride: string | undefined
  if (path && !text.includes(path)) {
    taskOverride = `${text}\n\nProject path: ${path}\nThis is an existing project. Read the docs/ folder first to understand the current architecture before making changes. Update or add docs as needed.`
  } else if (!path && projectsRoot.value && turns.value.length === 0) {
    taskOverride = `${text}\n\nProjects root: ${projectsRoot.value}\nDo NOT create any files or directories yet. Start by asking interview questions as structured JSON to understand the requirements first.`
  }

  await session.send(blocks, {
    agentId: 'architect',
    projectPath: path || undefined,
    taskOverride,
  })
}

function startCoder() {
  const path = projectPath.value || detectedProjectPath.value
  const projectId = route.params.projectId as string
  if (projectId) {
    router.push(`/app/projects/${projectId}/coder`)
  } else if (path) {
    router.push({ path: '/app/coder', query: { path, autorun: '1', source: 'architect' } })
  } else {
    router.push('/app/coder')
  }
}
</script>

<template>
  <div class="flex h-full bg-app">
    <!-- Main -->
    <div class="flex-1 flex flex-col min-w-0">
      <!-- Header -->
      <div class="shrink-0 flex items-center justify-between px-4 py-2">
        <div v-if="docsWritten && !isLoading && detectedProjectPath" class="flex items-center gap-2">
          <button
            class="rounded-lg bg-app-accent px-3 py-1.5 text-xs font-semibold text-black transition hover:bg-app-accent/80"
            @click="router.push({ path: '/app/projects', query: { open: detectedProjectPath } })">
            Open Project
          </button>
        </div>
      </div>

      <!-- Agent view -->
      <div class="flex-1 min-h-0 flex justify-center overflow-hidden">
        <div class="w-full max-w-2xl">
          <AgentView :turns="turns" :is-loading="isLoading" :status-message="statusMessage"
            @question-answer="handleQuestionAnswer">
            <template #empty>
              <DraftingCompass class="size-12 text-blue-400/30 mb-4" />
              <h2 class="text-xl font-semibold text-app mb-1">Architect</h2>
              <p v-if="hasProject" class="text-sm text-app-muted max-w-md">
                Add features, update docs, or refine the architecture of this project.
              </p>
              <p v-else class="text-sm text-app-muted max-w-md">
                Describe your project. I'll ask questions, then write the design docs.
              </p>
            </template>
          </AgentView>
        </div>
      </div>

      <!-- Input -->
      <div class="shrink-0 flex justify-center">
        <div class="w-full max-w-2xl">
          <AgentInput :placeholder="inputPlaceholder" :loading="isLoading" @send="handleSend" @stop="session.stop()" />
        </div>
      </div>
    </div>

    <!-- Sidebar: project files -->
    <div v-if="hasProject && (summary.docs.count > 0 || summary.fileTree.length > 0)"
      class="w-56 shrink-0 border-l border-[var(--app-border)] overflow-auto p-3 space-y-5">
      <!-- Docs -->
      <div v-if="summary.docs.count > 0">
        <p class="text-[10px] text-[var(--app-muted)] uppercase tracking-wider font-medium mb-2">Docs</p>
        <div class="space-y-0.5">
          <div v-for="doc in summary.docs.items" :key="doc.title"
            class="flex items-center gap-1.5 py-0.5 text-[11px]">
            <FileText class="size-3 text-violet-400 shrink-0" />
            <span class="text-[var(--app-foreground)] truncate">{{ doc.title }}</span>
          </div>
        </div>
      </div>

      <!-- Files -->
      <div v-if="summary.fileTree.length > 0">
        <p class="text-[10px] text-[var(--app-muted)] uppercase tracking-wider font-medium mb-2">Files</p>
        <div class="space-y-0.5">
          <div v-for="file in summary.fileTree" :key="file.name"
            class="flex items-center gap-1.5 py-0.5 text-[11px]">
            <Folder v-if="file.type === 'directory'" class="size-3 text-amber-400 shrink-0" />
            <File v-else class="size-3 text-[var(--app-muted)] shrink-0" />
            <span :class="file.type === 'directory' ? 'text-[var(--app-foreground)] font-medium' : 'text-[var(--app-muted)]'" class="truncate">{{ file.name }}</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
