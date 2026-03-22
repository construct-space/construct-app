<script setup lang="ts">
/**
 * Brainstorm Space — natural conversation with the Architect agent.
 * Uses AgentView for rendering. Agent follows Superpowers skills:
 * brainstorm → plan → write docs → hand off to Vibe.
 */
import { ref, computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAgentSession, type RequestBlock } from '@/operator/useAgentSession'
import { useProjectStore } from '@/stores/project'
import AgentView from '@/components/agent/AgentView.vue'
import AgentInput from '@/components/agent/AgentInput.vue'

const route = useRoute()
const router = useRouter()
const projectStore = useProjectStore()

const session = useAgentSession()
const { turns, isLoading, statusMessage } = session

const currentProject = computed(() => projectStore.currentProject)
const projectPath = computed(() => currentProject.value?.local_path || '')

const inputPlaceholder = computed(() =>
  turns.value.length === 0
    ? 'What do you want to build?'
    : 'Continue the conversation...'
)

function handleQuestionAnswer(_questionId: string, answer: string) {
  handleSend([{ type: 'text', content: answer }])
}

async function handleSend(blocks: RequestBlock[]) {
  const text = blocks
    .filter(b => b.type === 'text')
    .map(b => b.content)
    .join('\n')
  if (!text.trim()) return

  await session.send(blocks, {
    agentId: 'brainstorm',
    projectPath: projectPath.value || undefined,
  })
}

function startVibe() {
  const projectId = route.params.projectId as string
  if (projectId) {
    router.push(`/app/projects/${projectId}/vibe`)
  } else {
    router.push('/app/vibe')
  }
}

// Check if docs were written (for "Start Vibe" button)
const docsWritten = computed(() =>
  turns.value.some(turn =>
    turn.response.some(b =>
      b.type === 'tool' && b.tool === 'write_file' && (b.input?.includes('/docs/') || b.input?.includes('README'))
    )
  )
)
</script>

<template>
  <div class="flex flex-col h-full bg-app">
    <!-- Header -->
    <div class="shrink-0 flex items-center justify-between px-4 py-2 border-b border-app">
      <div class="flex items-center gap-2">
        <Icon name="i-lucide-sparkles" class="size-4 text-purple-400" />
        <span class="text-sm font-medium text-app">Oracle</span>
        <span v-if="currentProject" class="text-xs text-app-muted">· {{ currentProject.name }}</span>
      </div>
      <button
        v-if="docsWritten"
        class="rounded-lg bg-app-accent px-3 py-1.5 text-xs font-semibold text-black transition hover:bg-app-accent/80"
        @click="startVibe"
      >
        <Icon name="i-lucide-zap" class="size-3 inline mr-1" />
        Start Agent Smith
      </button>
    </div>

    <!-- Chat -->
    <div class="flex-1 min-h-0">
      <AgentView
        :turns="turns"
        :is-loading="isLoading"
        :status-message="statusMessage"
        @question-answer="handleQuestionAnswer"
      >
        <template v-if="turns.length === 0">
          <div class="flex flex-col items-center justify-center h-full px-8 text-center">
            <Icon name="i-lucide-sparkles" class="size-10 text-purple-400/30 mb-4" />
            <h2 class="text-lg font-semibold text-app mb-2">Drop an idea</h2>
            <p class="text-sm text-app-muted max-w-md">
              Describe what you want to build. I'll explore it with you, ask the right questions,
              and prepare everything for the Architect.
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
