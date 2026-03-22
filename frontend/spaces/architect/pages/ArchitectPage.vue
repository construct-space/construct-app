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
const currentProject = computed(() => projectStore.activeProject)
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

async function handleSend(blocks: RequestBlock[]) {
  const text = blocks
    .filter(b => b.type === 'text')
    .map(b => b.content)
    .join('\n')
  if (!text.trim()) return

  // Add project path context if available
  let taskText = text
  const path = projectPath.value || detectedProjectPath.value
  if (path && !text.includes(path)) {
    taskText = `${text}\n\nProject path: ${path}`
  } else if (!path && projectsRoot.value) {
    // Derive a project name from the description for first message
    if (turns.value.length === 0) {
      taskText = `${text}\n\nProjects root: ${projectsRoot.value}\nChoose a short creative project name (1-2 words, lowercase-kebab) and create docs at {projects_root}/{name}/docs/`
    }
  }

  await session.send(blocks.map(b =>
    b.type === 'text' ? { ...b, content: taskText } : b
  ), {
    agentId: 'architect',
    projectPath: path || undefined,
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
    <div class="shrink-0 flex items-center justify-between px-4 py-2 border-b border-app">
      <div class="flex items-center gap-2">
        <Icon name="i-lucide-compass" class="size-4 text-app-accent" />
        <span class="text-sm font-medium text-app">Architect</span>
        <span v-if="currentProject" class="text-xs text-app-muted">· {{ currentProject.name }}</span>
      </div>
      <button
        v-if="docsWritten && !isLoading"
        class="rounded-lg bg-app-accent px-3 py-1.5 text-xs font-semibold text-black transition hover:bg-app-accent/80"
        @click="startVibe"
      >
        <Icon name="i-lucide-zap" class="size-3 inline mr-1" />
        Start Vibe
      </button>
    </div>

    <!-- Agent view -->
    <div class="flex-1 min-h-0">
      <AgentView
        :turns="turns"
        :is-loading="isLoading"
        :status-message="statusMessage"
      >
        <template v-if="turns.length === 0">
          <div class="flex flex-col items-center justify-center h-full px-8 text-center">
            <Icon name="i-lucide-compass" class="size-10 text-app-accent/30 mb-4" />
            <h2 class="text-lg font-semibold text-app mb-2">What are we building?</h2>
            <p class="text-sm text-app-muted max-w-md">
              Describe your project. I'll write detailed design docs and an implementation
              plan, then hand off to Vibe to build it.
            </p>
          </div>
        </template>
      </AgentView>
    </div>

    <!-- Input -->
    <div class="shrink-0 px-4 py-3 border-t border-app">
      <AgentInput
        :placeholder="inputPlaceholder"
        @send="handleSend"
      />
    </div>
  </div>
</template>
