<script setup lang="ts">
import type { ArchitectPlan } from '../utils/documentsGenerator'
import type { TemplateConfig } from '@/utils/templates.config'

defineProps<{
  plan: ArchitectPlan
  projectPath: string
  initGit: boolean
  isKicking: boolean
  kickoffProgress: number
  progressMessage: string
  isConstructSpace: boolean
  detectedTemplate: TemplateConfig | null
  detectedBackendTemplate: TemplateConfig | null
  rawFrontendName: string | null
  rawBackendName: string | null
}>()

const emit = defineEmits<{
  'update:projectPath': [value: string]
  'update:initGit': [value: boolean]
  create: []
  back: []
  browse: []
}>()

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

function formatTechName(raw: string): string {
  const cleaned = raw.replace(/^custom-/, '').replace(/-/g, ' ')
  return capitalize(cleaned)
}

const MOBILE_TECHS = ['flutter', 'react-native', 'react native', 'expo', 'swift', 'swiftui', 'kotlin', 'ionic', 'capacitor']
const FULLSTACK_TECHS = ['nuxt', 'next', 'nextjs', 'next.js', 'nuxt.js', 'laravel', 'rails', 'ruby on rails', 'django', 'redwood', 'redwoodjs', 't3']

function detectCategory(raw: string | null, template: { category?: string } | null): string {
  if (template?.category === 'mobile') return 'App'
  if (template?.category === 'fullstack') return 'Fullstack'
  if (!raw) return 'Frontend'
  const key = raw.trim().toLowerCase()
  if (MOBILE_TECHS.some(t => key.includes(t))) return 'App'
  if (FULLSTACK_TECHS.some(t => key.includes(t))) return 'Fullstack'
  return 'Frontend'
}
</script>

<template>
  <div class="space-y-6">
    <!-- Header -->
    <div class="space-y-2">
      <div class="inline-flex items-center gap-2 px-2.5 py-1 rounded-full bg-app-accent/8 text-app-accent text-xs font-medium">
        <Icon name="i-lucide-settings-2" class="size-3" />
        Configure
      </div>
      <h2 class="text-2xl font-bold text-app tracking-tight">{{ plan.name }}</h2>
    </div>

    <!-- Kickoff progress -->
    <div v-if="isKicking" class="space-y-4 py-4">
      <div class="flex items-center gap-3">
        <div class="relative w-10 h-10">
          <div class="absolute inset-0 rounded-xl bg-app-accent/10" />
          <div class="absolute inset-0 flex items-center justify-center">
            <div class="config-spinner" />
          </div>
          <div class="absolute inset-0 flex items-center justify-center">
            <Icon name="i-lucide-hammer" class="size-4 text-app-accent" />
          </div>
        </div>
        <div>
          <p class="text-sm font-medium text-app">Creating your project</p>
          <p class="text-xs text-app-muted mt-0.5">{{ progressMessage }}</p>
        </div>
      </div>
      <div class="h-1.5 bg-white/6 rounded-full overflow-hidden">
        <div
          class="h-full bg-app-accent rounded-full transition-all duration-500 ease-out"
          :style="{ width: `${kickoffProgress}%` }"
        />
      </div>
    </div>

    <!-- Config form -->
    <div v-else class="space-y-5">
      <!-- Project directory -->
      <div class="space-y-2">
        <label class="text-[11px] text-app-muted/60 uppercase tracking-widest font-medium">Project Directory</label>
        <div class="flex items-center gap-2">
          <input
            :value="projectPath"
            type="text"
            class="flex-1 px-3 py-2.5 text-sm rounded-lg bg-white/4 text-app border border-white/8 focus:border-app-accent/40 focus:outline-none focus:ring-1 focus:ring-app-accent/20 transition-all placeholder:text-app-muted/30"
            placeholder="~/ConstructProjects/my-project"
            @input="emit('update:projectPath', ($event.target as HTMLInputElement).value)"
          >
          <button
            class="px-3 py-2.5 rounded-lg bg-white/4 border border-white/8 text-app-muted hover:text-app hover:bg-white/8 transition-all shrink-0"
            @click="emit('browse')"
          >
            <Icon name="i-lucide-folder-open" class="size-4" />
          </button>
        </div>
      </div>

      <!-- Framework scaffold -->
      <div class="space-y-2">
        <label class="text-[11px] text-app-muted/60 uppercase tracking-widest font-medium">Scaffold</label>

        <!-- Construct Space -->
        <div v-if="isConstructSpace" class="flex items-center gap-3 px-3.5 py-3 rounded-lg bg-white/4">
          <div class="w-8 h-8 rounded-lg flex items-center justify-center bg-white/8">
            <Icon :name="plan?.spaceIcon || 'i-lucide-puzzle'" class="size-4 text-app-muted" />
          </div>
          <div class="flex-1 min-w-0">
            <p class="text-sm font-medium text-app">Space: {{ plan?.spaceId }}</p>
            <p class="text-xs text-app-muted/60 mt-0.5">Creates code/space-{{ plan?.spaceId }}/ inside this project with a Vue 3 IIFE bundle</p>
          </div>
        </div>

        <!-- Frontend / Platform -->
        <div v-if="!isConstructSpace" class="flex items-center gap-3 px-3.5 py-3 rounded-lg bg-white/4">
          <div class="w-8 h-8 rounded-lg flex items-center justify-center bg-white/8">
            <Icon :name="detectedTemplate?.icon || 'i-lucide-smartphone'" class="size-4 text-app-muted" />
          </div>
          <div class="flex-1 min-w-0">
            <p class="text-sm font-medium text-app">
              {{ detectCategory(rawFrontendName, detectedTemplate) }}: {{ detectedTemplate ? detectedTemplate.name : rawFrontendName ? formatTechName(rawFrontendName) : 'Static HTML' }}
            </p>
            <p class="text-xs text-app-muted/60 mt-0.5">
              {{ detectedTemplate?.description || (rawFrontendName ? `Scaffold ${formatTechName(rawFrontendName)} project` : 'index.html, style.css, script.js') }}
            </p>
          </div>
        </div>

        <!-- Backend -->
        <div v-if="!isConstructSpace && (detectedBackendTemplate || rawBackendName)" class="flex items-center gap-3 px-3.5 py-3 rounded-lg bg-white/4">
          <div class="w-8 h-8 rounded-lg flex items-center justify-center bg-white/8">
            <Icon :name="detectedBackendTemplate?.icon || 'i-lucide-server'" class="size-4 text-app-muted" />
          </div>
          <div class="flex-1 min-w-0">
            <p class="text-sm font-medium text-app">
              Backend: {{ detectedBackendTemplate ? detectedBackendTemplate.name : rawBackendName ? formatTechName(rawBackendName) : '' }}
            </p>
            <p class="text-xs text-app-muted/60 mt-0.5">
              {{ detectedBackendTemplate?.description || (rawBackendName ? `Scaffold ${formatTechName(rawBackendName)} backend` : '') }}
            </p>
          </div>
        </div>
      </div>

      <!-- Git init -->
      <div class="space-y-2">
        <label class="text-[11px] text-app-muted/60 uppercase tracking-widest font-medium">Options</label>
        <button
          class="w-full flex items-center gap-3 px-3.5 py-3 rounded-lg transition-all duration-150 text-left"
          :class="initGit
            ? 'bg-app-accent/8 ring-1 ring-app-accent/25'
            : 'bg-white/4 hover:bg-white/6'"
          @click="emit('update:initGit', !initGit)"
        >
          <div
            class="w-4.5 h-4.5 rounded flex items-center justify-center shrink-0 transition-all"
            :class="initGit ? 'bg-app-accent' : 'border border-white/15'"
          >
            <Icon v-if="initGit" name="i-lucide-check" class="size-2.5 text-white" />
          </div>
          <div class="flex-1 min-w-0">
            <p class="text-sm font-medium text-app">Initialize git repository</p>
            <p class="text-xs text-app-muted/50 mt-0.5">Run git init in the project directory</p>
          </div>
          <Icon name="i-lucide-git-branch" class="size-4 text-app-muted/30 shrink-0" />
        </button>
      </div>
    </div>

    <!-- Actions -->
    <div v-if="!isKicking" class="flex items-center gap-3 pt-1">
      <Button :disabled="!projectPath.trim()" @click="emit('create')">
        <template #leading>
          <Icon name="i-lucide-rocket" class="size-4" />
        </template>
        Create Project
      </Button>
      <button class="text-xs text-app-muted/50 hover:text-app-muted transition-colors" @click="emit('back')">
        Back to plan
      </button>
    </div>
  </div>
</template>

<style scoped>
.config-spinner {
  width: 32px;
  height: 32px;
  border: 1.5px solid transparent;
  border-top-color: var(--app-accent);
  border-radius: 50%;
  animation: config-spin 1s cubic-bezier(0.4, 0, 0.2, 1) infinite;
}

@keyframes config-spin {
  to { transform: rotate(360deg); }
}
</style>
