<script setup lang="ts">
/**
 * Architect Space — describe a project, agent writes docs, hand off to Vibe.
 *
 * Flow: User describes → Architect writes docs to project/docs/ → "Start Vibe" button.
 * No questions step, no plan JSON, no templates, no scaffolding.
 * Architect ONLY writes markdown docs. Vibe writes code.
 */
import { ref, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAgentSession, type RequestBlock } from '@/operator/useAgentSession'
import { useProjectStore } from '@/stores/project'
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

const inputPlaceholder = computed(() =>
  turns.value.length === 0
    ? 'Describe what you want to build...'
    : 'Continue or refine...'
)

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
    taskOverride = `${text}\n\nProject path: ${path}`
  } else if (!path && projectsRoot.value && turns.value.length === 0) {
    taskOverride = `${text}\n\nProjects root: ${projectsRoot.value}\nDo NOT create any files or directories yet. Start by asking interview questions as structured JSON to understand the requirements first.`
  }

  await session.send(blocks, {
    agentId: 'architect',
    projectPath: path || undefined,
    taskOverride,
  })
}

function startVibe() {
  const path = projectPath.value || detectedProjectPath.value
  const projectId = route.params.projectId as string
  if (projectId) {
    router.push(`/app/projects/${projectId}/vibe`)
  } else if (path) {
    // Navigate to vibe with the project path
    router.push({ path: '/app/vibe', query: { path, autorun: '1', source: 'architect' } })
  } else {
    router.push('/app/vibe')
  }
}
</script>

<template>
  <div class="flex flex-col h-full bg-app">
    <!-- Header -->
    <div class="shrink-0 flex items-center justify-between px-4 py-2">
<div v-if="docsWritten && !isLoading" class="flex items-center gap-2">
        <button v-if="detectedProjectPath"
          class="rounded-lg border border-app-border px-3 py-1.5 text-xs font-medium text-app transition hover:bg-white/5"
          @click="router.push({ path: '/app/projects', query: { open: detectedProjectPath } })">
          <Icon name="i-lucide-folder-open" class="size-3 inline mr-1" />
          Open Project
        </button>
        <button
          class="rounded-lg bg-app-accent px-3 py-1.5 text-xs font-semibold text-black transition hover:bg-app-accent/80"
          @click="startVibe">
          <Icon name="i-lucide-zap" class="size-3 inline mr-1" />
          Start Vibe
        </button>
      </div>
    </div>

    <!-- Agent view -->
    <div class="flex-1 min-h-0 flex justify-center overflow-hidden">
      <div class="w-full max-w-2xl">
      <AgentView :turns="turns" :is-loading="isLoading" :status-message="statusMessage"
        @question-answer="handleQuestionAnswer">
        <template #empty>
          <Icon name="i-lucide-drafting-compass" class="size-12 text-blue-400/30 mb-4" />
          <h2 class="text-xl font-semibold text-app mb-1">Architect</h2>
          <p class="text-sm text-app-muted max-w-md">
            Describe your project. I'll write the design docs, then hand off to Vibe.
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
</template>
