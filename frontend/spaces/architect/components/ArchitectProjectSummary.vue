<script setup lang="ts">
/**
 * ArchitectProjectSummary - Right panel showing live project decisions and plan
 */
import type { ArchitectPlan } from '../utils/documentsGenerator'
import type { ArchitectDecision } from '../composables/useArchitectEngine'

const props = defineProps<{
  description: string
  decisions: ArchitectDecision[]
  plan: ArchitectPlan | null
  isDone: boolean
  isInsideProject: boolean
  isKicking: boolean
  projectName?: string
}>()

const emit = defineEmits<{
  createProject: []
  saveFeature: []
  editChoices: [index: number]
  openVibe: []
}>()

// Derive a display name from plan or description
const displayName = computed(() => {
  if (props.plan?.name) return props.plan.name
  if (!props.description) return ''
  // Capitalize first few words
  const words = props.description.split(/\s+/).slice(0, 4)
  return words.map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
})

const displayDescription = computed(() => {
  if (props.plan?.description) return props.plan.description
  return props.description
})

function getAnswerDisplay(val: string | string[]): string {
  if (Array.isArray(val)) return val.join(', ')
  return String(val)
}
</script>

<template>
  <div class="h-full flex flex-col">
    <!-- Header -->
    <div class="px-6 pt-6 pb-4">
      <p class="text-[11px] text-app-muted/60 uppercase tracking-[1.5px] font-semibold mb-3">WE ARE BUILDING</p>
      <h2 v-if="displayName" class="text-2xl font-bold text-app-foreground leading-tight">{{ displayName }}</h2>
      <p v-if="displayDescription && displayDescription !== displayName" class="text-sm text-app-muted mt-1">{{ displayDescription }}</p>
    </div>

    <div class="h-px bg-[var(--app-border)]/20 mx-6" />

    <!-- Decisions -->
    <div class="flex-1 overflow-y-auto px-6 py-4 space-y-2">
      <p class="text-[11px] text-app-muted/60 uppercase tracking-[1.5px] font-semibold mb-3">DECISIONS</p>

      <div
        v-for="decision in decisions"
        :key="decision.id"
        class="rounded-lg px-4 py-3 transition-all duration-200"
        :class="[
          decision.status === 'done' ? 'bg-[color-mix(in_srgb,var(--app-background),white_6%)]' : '',
          decision.status === 'active' ? 'bg-[color-mix(in_srgb,var(--app-background),white_6%)] ring-1 ring-[var(--app-accent)]/30' : '',
          decision.status === 'pending' ? 'bg-[color-mix(in_srgb,var(--app-background),white_3%)] opacity-40' : '',
        ]"
      >
        <p
          class="text-[10px] uppercase tracking-wider font-medium"
          :class="decision.status === 'active' ? 'text-[var(--app-accent)]' : 'text-app-muted/60'"
        >
          {{ decision.label }}
        </p>
        <p v-if="decision.status === 'done'" class="text-sm text-app-foreground mt-0.5">
          {{ getAnswerDisplay(decision.value) }}
        </p>
        <p v-else-if="decision.status === 'active'" class="text-sm text-app-muted italic mt-0.5">deciding...</p>
        <p v-else class="text-sm text-app-muted/30 mt-0.5">&mdash;</p>

        <!-- Checkmark for done -->
        <div v-if="decision.status === 'done'" class="flex justify-end -mt-4">
          <Icon name="i-lucide-check" class="size-3 text-[var(--app-accent)] opacity-60" />
        </div>
      </div>

      <!-- Plan sections (after generation) -->
      <template v-if="isDone && plan">
        <div class="h-px bg-[var(--app-border)]/20 my-4" />

        <p class="text-[11px] text-app-muted/60 uppercase tracking-[1.5px] font-semibold mb-3">FEATURES</p>
        <div class="space-y-1">
          <div v-for="(feature, i) in (plan.docs?.prd?.coreFeatures || plan.prd?.coreFeatures)?.slice(0, 8)" :key="i" class="flex items-start gap-2 py-1">
            <Icon name="i-lucide-circle-dot" class="size-3 text-[var(--app-accent)] opacity-60 mt-0.5 shrink-0" />
            <p class="text-sm text-app-foreground/80">{{ feature }}</p>
          </div>
        </div>

        <template v-if="(plan.docs?.prd?.mvpScope || plan.prd?.mvpScope)?.length">
          <div class="h-px bg-[var(--app-border)]/20 my-4" />
          <p class="text-[11px] text-app-muted/60 uppercase tracking-[1.5px] font-semibold mb-3">MVP SCOPE</p>
          <div class="space-y-1">
            <div v-for="(item, i) in (plan.docs?.prd?.mvpScope || plan.prd?.mvpScope)!.slice(0, 6)" :key="i" class="flex items-start gap-2 py-1">
              <Icon name="i-lucide-square" class="size-3 text-app-muted/40 mt-0.5 shrink-0" />
              <p class="text-sm text-app-muted">{{ item }}</p>
            </div>
          </div>
        </template>
      </template>

      <!-- Placeholder sections before plan -->
      <template v-else>
        <div class="h-px bg-[var(--app-border)]/20 my-4" />
        <p class="text-[11px] text-app-muted/60 uppercase tracking-[1.5px] font-semibold mb-2">FEATURES</p>
        <p class="text-sm text-app-muted/30 italic">Generated after all decisions</p>

        <div class="h-px bg-[var(--app-border)]/20 my-4" />
        <p class="text-[11px] text-app-muted/60 uppercase tracking-[1.5px] font-semibold mb-2">STRUCTURE</p>
        <p class="text-sm text-app-muted/30 italic">Generated after plan</p>
      </template>
    </div>

    <!-- Create button -->
    <div class="px-6 py-4 border-t border-[var(--app-border)]/20">
      <div class="space-y-2">
        <button
          v-if="isInsideProject"
          class="w-full py-3 rounded-xl text-sm font-semibold transition-all duration-200"
          :class="isDone
            ? 'bg-[var(--app-accent)] text-[var(--app-accent-foreground)] hover:opacity-90 cursor-pointer'
            : 'bg-[color-mix(in_srgb,var(--app-background),white_6%)] text-app-muted/40 cursor-not-allowed border border-[var(--app-border)]/20'"
          :disabled="!isDone || isKicking"
          @click="emit('saveFeature')"
        >
          {{ isKicking ? 'Saving...' : 'Save Feature Plan' }}
        </button>
        <button
          v-else
          class="w-full py-3 rounded-xl text-sm font-semibold transition-all duration-200"
          :class="isDone
            ? 'bg-[var(--app-accent)] text-[var(--app-accent-foreground)] hover:opacity-90 cursor-pointer'
            : 'bg-[color-mix(in_srgb,var(--app-background),white_6%)] text-app-muted/40 cursor-not-allowed border border-[var(--app-border)]/20'"
          :disabled="!isDone || isKicking"
          @click="emit('createProject')"
        >
          {{ isKicking ? 'Creating...' : 'Create Project →' }}
        </button>

        <button
          class="w-full py-3 rounded-xl text-sm font-semibold transition-all duration-200 border"
          :class="isDone
            ? 'border-amber-400/30 bg-amber-400/10 text-amber-100 hover:bg-amber-400/15 cursor-pointer'
            : 'border-[var(--app-border)]/20 bg-[color-mix(in_srgb,var(--app-background),white_4%)] text-app-muted/40 cursor-not-allowed'"
          :disabled="!isDone || isKicking"
          @click="emit('openVibe')"
        >
          Start Vibe Build
        </button>
      </div>
    </div>
  </div>
</template>
