<script setup lang="ts">
import { computed } from 'vue'
import type { ArchitectPlan } from '../utils/documentsGenerator'

const props = defineProps<{
  plan: ArchitectPlan
  isInsideProject: boolean
  isKicking: boolean
}>()

defineEmits<{
  createProject: []
  saveFeature: []
  editChoices: []
}>()

const prd = computed(() => props.plan.docs?.prd || props.plan.prd || {})
</script>

<template>
  <div class="space-y-6">
    <!-- Header -->
    <div class="space-y-2">
      <div class="inline-flex items-center gap-2 px-2.5 py-1 rounded-full bg-green-500/8 text-green-400 text-xs font-medium">
        <Icon name="i-lucide-check-circle" class="size-3" />
        Plan Ready
      </div>
      <h2 class="text-2xl font-bold text-app tracking-tight">{{ plan.name }}</h2>
      <p class="text-sm text-app-muted leading-relaxed">{{ plan.description }}</p>
    </div>

    <!-- Tech stack decisions -->
    <div class="space-y-1.5">
      <p class="text-[11px] text-app-muted/60 uppercase tracking-widest font-medium mb-2">Tech Stack</p>
      <div class="grid grid-cols-2 gap-1.5">
        <div
          v-for="(value, key) in plan.decisions"
          v-show="value && (Array.isArray(value) ? value.length > 0 : true)"
          :key="key"
          class="flex items-center gap-2.5 px-3 py-2.5 rounded-lg bg-white/4"
        >
          <span class="text-[11px] text-app-muted/50 uppercase tracking-wider w-16 shrink-0">{{ key }}</span>
          <span class="text-xs font-medium text-app truncate">
            {{ Array.isArray(value) ? value.join(', ') : value }}
          </span>
        </div>
      </div>
    </div>

    <!-- Core features -->
    <div v-if="prd?.coreFeatures?.length" class="space-y-2.5">
      <p class="text-[11px] text-app-muted/60 uppercase tracking-widest font-medium">
        {{ isInsideProject ? 'Components' : 'Core Features' }}
      </p>
      <div class="flex flex-wrap gap-1.5">
        <span
          v-for="feature in prd.coreFeatures"
          :key="feature"
          class="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg bg-white/4 text-app"
        >
          <span class="w-1 h-1 rounded-full bg-app-accent/50 shrink-0" />
          {{ feature }}
        </span>
      </div>
    </div>

    <!-- PRD preview -->
    <div v-if="prd?.overview" class="space-y-2">
      <p class="text-[11px] text-app-muted/60 uppercase tracking-widest font-medium">Overview</p>
      <p class="text-xs text-app-muted leading-relaxed">{{ prd.overview }}</p>
    </div>

    <!-- Actions -->
    <div class="flex items-center gap-3 pt-2">
      <Button v-if="!isInsideProject" :loading="isKicking" :disabled="isKicking" @click="$emit('createProject')">
        <template #leading>
          <Icon name="i-lucide-rocket" class="size-4" />
        </template>
        {{ isKicking ? 'Creating...' : 'Create Project' }}
      </Button>
      <Button v-else @click="$emit('saveFeature')">
        <template #leading>
          <Icon name="i-lucide-save" class="size-4" />
        </template>
        Save Feature Plan
      </Button>
      <button class="text-xs text-app-muted/50 hover:text-app-muted transition-colors" @click="$emit('editChoices')">
        Edit choices
      </button>
    </div>
  </div>
</template>
