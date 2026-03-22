<script setup lang="ts">
/**
 * Architect Space — Superpowers-style brainstorm → plan → docs → vibe handoff.
 *
 * Simple chat UI powered by AgentView. The Architect agent asks questions
 * naturally, writes plans as docs, and hands off tasks to Vibe.
 * No custom interview flow — just a conversation with block rendering.
 */
import { ref, computed, onMounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAgentSession, type RequestBlock, type Turn } from '@/operator/useAgentSession'
import { useOperator } from '@/operator'
import { useProjectStore } from '@/stores/project'
import AgentView from '@/components/agent/AgentView.vue'
import AgentInput from '@/components/agent/AgentInput.vue'
import { storeVibeHandoff } from '../utils/vibeHandoff'

const route = useRoute()
const router = useRouter()
const operator = useOperator()
const projectStore = useProjectStore()

const session = useAgentSession()
const { turns, isLoading, statusMessage } = session

// Project context
const currentProject = computed(() => projectStore.activeProject)
const projectPath = computed(() => currentProject.value?.local_path || '')

// Check if the last turn's response contains a plan (for "Start Vibe" button)
const hasPlan = computed(() => {
  if (turns.value.length === 0) return false
  const lastTurn = turns.value[turns.value.length - 1]
  return lastTurn.response.some(b => b.type === 'plan' || b.type === 'tasklist')
})

// Check for docs written (look for tool calls to write_file with docs/ paths)
const docsWritten = computed(() => {
  return turns.value.some(turn =>
    turn.response.some(b =>
      b.type === 'tool' && b.tool === 'write_file' && b.input?.includes('/docs/')
    )
  )
})

async function handleSend(blocks: RequestBlock[]) {
  const text = blocks
    .filter(b => b.type === 'text')
    .map(b => b.content)
    .join('\n')

  if (!text.trim()) return

  // Build context prefix for the agent
  let contextPrefix = ''
  if (projectPath.value) {
    contextPrefix = `[Project: ${currentProject.value?.name || 'Unknown'} at ${projectPath.value}]\n\n`
  }

  await session.send(blocks, {
    agentId: 'architect',
    model: undefined, // use default
    space: 'architect',
    projectPath: projectPath.value || undefined,
  })
}

async function startVibe() {
  // Extract the plan from the last conversation
  const lastPlanTurn = [...turns.value].reverse().find(t =>
    t.response.some(b => b.type === 'plan' || b.type === 'tasklist')
  )

  if (!lastPlanTurn) return

  // Store handoff data for Vibe
  const description = turns.value[0]?.request
    .filter(b => b.type === 'text')
    .map(b => b.content)
    .join('\n') || ''

  storeVibeHandoff({
    source: 'architect',
    description,
    projectId: currentProject.value?.id,
    plan: lastPlanTurn.response.find(b => b.type === 'plan') as Record<string, unknown> | undefined,
  })

  // Navigate to Vibe
  const projectId = route.params.projectId as string
  if (projectId) {
    router.push(`/app/projects/${projectId}/vibe`)
  } else {
    router.push('/app/vibe')
  }
}

// Auto-focus input on mount
onMounted(() => {
  // Session ready
})
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
      <div class="flex items-center gap-2">
        <button
          v-if="hasPlan || docsWritten"
          class="rounded-lg bg-app-accent px-3 py-1.5 text-xs font-semibold text-black transition hover:bg-app-accent/80"
          @click="startVibe"
        >
          <Icon name="i-lucide-zap" class="size-3 inline mr-1" />
          Start Vibe
        </button>
      </div>
    </div>

    <!-- Chat area -->
    <div class="flex-1 overflow-hidden">
      <AgentView
        :turns="turns"
        :is-loading="isLoading"
        :status-message="statusMessage"
      >
        <!-- Empty state -->
        <template v-if="turns.length === 0">
          <div class="flex flex-col items-center justify-center h-full px-8 text-center">
            <Icon name="i-lucide-compass" class="size-10 text-app-accent/30 mb-4" />
            <h2 class="text-lg font-semibold text-app mb-2">What are we building?</h2>
            <p class="text-sm text-app-muted max-w-md">
              Describe your project idea. I'll ask clarifying questions, then write a
              detailed plan with bite-sized tasks for Vibe to execute.
            </p>
          </div>
        </template>
      </AgentView>
    </div>

    <!-- Input -->
    <div class="shrink-0 px-4 py-3 border-t border-app">
      <AgentInput
        :placeholder="turns.length === 0
          ? 'Describe what you want to build...'
          : 'Answer, clarify, or say \\'write the plan\\'...'
        "
        @send="handleSend"
      />
    </div>
  </div>
</template>
