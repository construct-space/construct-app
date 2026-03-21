<script setup lang="ts">
/**
 * ArchitectStepView - Main view for current planning step
 * Shows question with visual option cards
 */
import type { InterviewQuestion } from '../data/architect-knowledge'

const props = defineProps<{
  step: 'describe' | 'question' | 'generating' | 'complete'
  question: InterviewQuestion | null
  appDescription: string
  isLoading: boolean
  streamingText: string
}>()

const emit = defineEmits<{
  (e: 'describe', value: string): void
  (e: 'select', value: string | string[]): void
  (e: 'notSure'): void
}>()

// Local state
const description = ref('')
const selectedSingle = ref<string | null>(null)
const selectedMulti = ref<string[]>([])

// Reset selections when question changes
watch(() => props.question?.id, () => {
  selectedSingle.value = null
  selectedMulti.value = []
})

function handleDescribe() {
  if (description.value.trim()) {
    emit('describe', description.value.trim())
  }
}

function selectOption(value: string) {
  if (props.question?.type === 'multi') {
    const idx = selectedMulti.value.indexOf(value)
    if (idx === -1) {
      // Handle "none" option
      if (value === 'none') {
        selectedMulti.value = ['none']
      } else {
        selectedMulti.value = selectedMulti.value.filter(v => v !== 'none')
        selectedMulti.value.push(value)
      }
    } else {
      selectedMulti.value.splice(idx, 1)
    }
  } else {
    selectedSingle.value = value
  }
}

function isSelected(value: string): boolean {
  if (props.question?.type === 'multi') {
    return selectedMulti.value.includes(value)
  }
  return selectedSingle.value === value
}

function canContinue(): boolean {
  if (props.question?.type === 'multi') {
    return selectedMulti.value.length > 0
  }
  return selectedSingle.value !== null
}

function handleContinue() {
  if (props.question?.type === 'multi') {
    emit('select', [...selectedMulti.value])
  } else if (selectedSingle.value) {
    emit('select', selectedSingle.value)
  }
}

// Starter prompts
const starterPrompts = [
  { icon: 'i-lucide-layout-dashboard', text: 'A dashboard for tracking metrics' },
  { icon: 'i-lucide-shopping-cart', text: 'An e-commerce store' },
  { icon: 'i-lucide-message-circle', text: 'A real-time chat application' },
  { icon: 'i-lucide-check-square', text: 'A task management tool' }
]
</script>

<template>
  <div class="h-full flex flex-col">
    <!-- DESCRIBE STEP -->
    <div v-if="step === 'describe'" class="flex-1 flex items-center justify-center p-8">
      <div class="w-full max-w-2xl">
        <!-- Header -->
        <div class="text-center mb-8">
          <div class="w-16 h-16 rounded-2xl bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center mx-auto mb-4">
            <Icon name="i-lucide-wand-2" class="size-8 text-white" />
          </div>
          <h1 class="text-2xl font-bold text-app mb-2">What do you want to build?</h1>
          <p class="text-app-muted">Describe your idea and I'll help you plan the perfect tech stack</p>
        </div>

        <!-- Input -->
        <div class="relative mb-6">
          <Textarea
            v-model="description"
            placeholder="I want to build..."
            :rows="4"
            autofocus
            class="text-lg"
            @keydown.meta.enter="handleDescribe"
          />
          <div class="absolute bottom-3 right-3">
            <Button
              color="primary"
              :disabled="!description.trim()"
              @click="handleDescribe"
            >
              <template #leading>
                <Icon name="i-lucide-arrow-right" class="size-4" />
              </template>
              Continue
            </Button>
          </div>
        </div>

        <!-- Starters -->
        <div class="space-y-2">
          <p class="text-xs text-app-muted uppercase tracking-wider text-center">Or start with</p>
          <div class="flex flex-wrap gap-2 justify-center">
            <button
              v-for="prompt in starterPrompts"
              :key="prompt.text"
              class="flex items-center gap-2 px-4 py-2 rounded-full bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors text-sm text-app"
              @click="description = prompt.text"
            >
              <Icon :name="prompt.icon" class="size-4 text-app-muted" />
              {{ prompt.text }}
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- QUESTION STEP -->
    <div v-else-if="step === 'question' && question" class="flex-1 flex flex-col p-8 overflow-y-auto">
      <div class="flex-1 flex items-center justify-center">
        <div class="w-full max-w-3xl">
          <!-- Question -->
          <h2 class="text-xl font-semibold text-app text-center mb-8">{{ question.question }}</h2>

          <!-- Options Grid -->
          <div
            class="grid gap-4 mb-8"
            :class="question.options.length <= 3 ? 'grid-cols-1 md:grid-cols-3' : 'grid-cols-1 md:grid-cols-2'"
          >
            <button
              v-for="option in question.options"
              :key="option.value"
              class="group relative flex flex-col items-center p-6 rounded-2xl border-2 transition-all text-center"
              :class="[
                isSelected(option.value)
                  ? 'border-violet-500 bg-violet-500/10 shadow-lg shadow-violet-500/20'
                  : 'border-gray-200 dark:border-gray-700 hover:border-violet-500/50 bg-white dark:bg-gray-800/50'
              ]"
              @click="selectOption(option.value)"
            >
              <!-- Selection indicator -->
              <div
                class="absolute top-3 right-3 w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all"
                :class="[
                  isSelected(option.value)
                    ? 'border-violet-500 bg-violet-500'
                    : 'border-gray-300 dark:border-gray-600'
                ]"
              >
                <Icon
                  v-if="isSelected(option.value)"
                  name="i-lucide-check"
                  class="size-3 text-white"
                />
              </div>

              <!-- Icon -->
              <div
                class="w-12 h-12 rounded-xl flex items-center justify-center mb-4 transition-colors"
                :class="isSelected(option.value) ? 'bg-violet-500/20' : 'bg-gray-100 dark:bg-gray-700'"
              >
                <Icon
                  :name="option.icon || 'i-lucide-box'"
                  class="size-6"
                  :class="isSelected(option.value) ? 'text-violet-500' : 'text-app-muted'"
                />
              </div>

              <!-- Text -->
              <p class="font-medium text-app mb-1">{{ option.label }}</p>
              <p class="text-sm text-app-muted line-clamp-2">{{ option.description }}</p>
            </button>
          </div>

          <!-- Actions -->
          <div class="flex items-center justify-between">
            <button
              class="text-sm text-app-muted hover:text-violet-500 transition-colors flex items-center gap-2"
              @click="emit('notSure')"
            >
              <Icon name="i-lucide-help-circle" class="size-4" />
              Not sure? Get a recommendation
            </button>

            <Button
              color="primary"
              size="lg"
              :disabled="!canContinue()"
              @click="handleContinue"
            >
              <template #leading>
                <Icon name="i-lucide-arrow-right" class="size-4" />
              </template>
              Continue
            </Button>
          </div>
        </div>
      </div>
    </div>

    <!-- GENERATING STEP -->
    <div v-else-if="step === 'generating'" class="flex-1 flex items-center justify-center p-8">
      <div class="w-full max-w-xl text-center">
        <div class="w-20 h-20 rounded-full bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center mx-auto mb-6 animate-pulse">
          <Icon name="i-lucide-sparkles" class="size-10 text-white" />
        </div>
        <h2 class="text-xl font-semibold text-app mb-2">Creating your project plan...</h2>
        <p class="text-app-muted mb-6">Analyzing your choices and generating recommendations</p>

        <!-- Streaming preview -->
        <div v-if="streamingText" class="text-left bg-gray-50 dark:bg-gray-800/50 rounded-xl p-4 max-h-48 overflow-y-auto">
          <p class="text-sm text-app-muted whitespace-pre-wrap">{{ streamingText }}</p>
        </div>
      </div>
    </div>

    <!-- COMPLETE STEP -->
    <div v-else-if="step === 'complete'" class="flex-1 flex items-center justify-center p-8">
      <div class="w-full max-w-xl text-center">
        <div class="w-20 h-20 rounded-full bg-green-500 flex items-center justify-center mx-auto mb-6">
          <Icon name="i-lucide-check" class="size-10 text-white" />
        </div>
        <h2 class="text-xl font-semibold text-app mb-2">Your project plan is ready!</h2>
        <p class="text-app-muted">Review your choices on the left, then create your project</p>
      </div>
    </div>

    <!-- LOADING -->
    <div v-else-if="isLoading" class="flex-1 flex items-center justify-center">
      <Icon name="i-lucide-loader-2" class="size-8 text-violet-500 animate-spin" />
    </div>
  </div>
</template>
