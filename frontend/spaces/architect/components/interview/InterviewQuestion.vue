<template>
  <div class="interview-question mt-4">
    <!-- Single Choice - Card Grid -->
    <div v-if="question.type === 'single'" class="grid gap-3" :class="gridClass">
      <button
        v-for="opt in question.options"
        :key="opt.value"
        class="option-card group relative flex flex-col items-start p-4 rounded-lg border-2 transition-all text-left"
        :class="[
          selected === opt.value && !showOtherInput
            ? 'border-[var(--app-accent)] bg-[var(--app-accent)]/10'
            : 'border-gray-200/50 dark:border-gray-700/50 hover:border-[var(--app-accent)]/50 bg-white/50 dark:bg-white/5'
        ]"
        @click="selectSingle(opt.value)"
      >
        <div class="flex items-center gap-3 w-full">
          <div
            class="flex-shrink-0 w-10 h-10 rounded-lg flex items-center justify-center transition-colors"
            :class="selected === opt.value && !showOtherInput ? 'bg-[var(--app-accent)]/20' : 'bg-gray-100 dark:bg-gray-800'"
          >
            <Icon
              :name="opt.icon || 'i-lucide-box'"
              class="size-5"
              :class="selected === opt.value && !showOtherInput ? 'text-app-accent' : 'text-app-muted'"
            />
          </div>
          <div class="flex-1 min-w-0">
            <p class="font-medium text-app text-sm">{{ opt.label }}</p>
            <p class="text-xs text-app-muted mt-0.5 line-clamp-2">{{ opt.description }}</p>
          </div>
          <div
            class="flex-shrink-0 w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all"
            :class="selected === opt.value && !showOtherInput
              ? 'border-[var(--app-accent)] bg-[var(--app-accent)]'
              : 'border-gray-300 dark:border-gray-600'"
          >
            <Icon
              v-if="selected === opt.value && !showOtherInput"
              name="i-lucide-check"
              class="size-3 text-white"
            />
          </div>
        </div>
      </button>

      <!-- Other Option -->
      <button
        class="option-card group relative flex flex-col items-start p-4 rounded-lg border-2 transition-all text-left"
        :class="[
          showOtherInput
            ? 'border-[var(--app-accent)] bg-[var(--app-accent)]/10'
            : 'border-gray-200/50 dark:border-gray-700/50 hover:border-[var(--app-accent)]/50 bg-white/50 dark:bg-white/5'
        ]"
        @click="enableOtherInput"
      >
        <div class="flex items-center gap-3 w-full">
          <div
            class="flex-shrink-0 w-10 h-10 rounded-lg flex items-center justify-center transition-colors"
            :class="showOtherInput ? 'bg-[var(--app-accent)]/20' : 'bg-gray-100 dark:bg-gray-800'"
          >
            <Icon
              name="i-lucide-pencil"
              class="size-5"
              :class="showOtherInput ? 'text-app-accent' : 'text-app-muted'"
            />
          </div>
          <div class="flex-1 min-w-0">
            <p class="font-medium text-app text-sm">Other</p>
            <p class="text-xs text-app-muted mt-0.5">Enter a custom choice</p>
          </div>
          <div
            class="flex-shrink-0 w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all"
            :class="showOtherInput
              ? 'border-[var(--app-accent)] bg-[var(--app-accent)]'
              : 'border-gray-300 dark:border-gray-600'"
          >
            <Icon
              v-if="showOtherInput"
              name="i-lucide-check"
              class="size-3 text-white"
            />
          </div>
        </div>
      </button>
    </div>

    <!-- Other Input Field (Single) -->
    <div v-if="question.type === 'single' && showOtherInput" class="mt-3">
      <Input
        v-model="otherValue"
        placeholder="Type your custom choice..."
        autofocus
        @keyup.enter="submit"
      />
    </div>

    <!-- Multi Choice - Checkbox List -->
    <div v-else-if="question.type === 'multi'" class="space-y-2">
      <button
        v-for="opt in question.options"
        :key="opt.value"
        class="w-full flex items-center gap-3 p-3 rounded-lg border transition-all text-left"
        :class="[
          multiSelected.includes(opt.value)
            ? 'border-[var(--app-accent)] bg-[var(--app-accent)]/10'
            : 'border-gray-200/50 dark:border-gray-700/50 hover:border-[var(--app-accent)]/50 bg-white/50 dark:bg-white/5'
        ]"
        @click="toggleMulti(opt.value)"
      >
        <div
          class="flex-shrink-0 w-5 h-5 rounded border-2 flex items-center justify-center transition-all"
          :class="multiSelected.includes(opt.value)
            ? 'border-[var(--app-accent)] bg-[var(--app-accent)]'
            : 'border-gray-300 dark:border-gray-600'"
        >
          <Icon
            v-if="multiSelected.includes(opt.value)"
            name="i-lucide-check"
            class="size-3 text-white"
          />
        </div>
        <div
          class="flex-shrink-0 w-8 h-8 rounded-md flex items-center justify-center"
          :class="multiSelected.includes(opt.value) ? 'bg-[var(--app-accent)]/20' : 'bg-gray-100 dark:bg-gray-800'"
        >
          <Icon
            :name="opt.icon || 'i-lucide-box'"
            class="size-4"
            :class="multiSelected.includes(opt.value) ? 'text-app-accent' : 'text-app-muted'"
          />
        </div>
        <div class="flex-1 min-w-0">
          <p class="font-medium text-app text-sm">{{ opt.label }}</p>
          <p class="text-xs text-app-muted">{{ opt.description }}</p>
        </div>
      </button>
    </div>

    <!-- Actions -->
    <div class="flex items-center justify-between mt-4 pt-4 border-t border-gray-200/50 dark:border-gray-700/50">
      <button
        class="text-sm text-app-muted hover:text-app-accent transition-colors flex items-center gap-1.5"
        @click="emit('notSure')"
      >
        <Icon name="i-lucide-help-circle" class="size-4" />
        <span>Not sure? Get a recommendation</span>
      </button>

      <Button
        :disabled="!canSubmit"
        color="primary"
        size="sm"
        @click="submit"
      >
        <template #leading>
          <Icon name="i-lucide-arrow-right" class="size-4" />
        </template>
        Continue
      </Button>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { InterviewQuestion } from '../../data/architect-knowledge'

interface Props {
  question: InterviewQuestion
}

const props = defineProps<Props>()

const emit = defineEmits<{
  select: [value: string | string[]]
  notSure: []
}>()

// State
const selected = ref<string | null>(null)
const multiSelected = ref<string[]>([])
const showOtherInput = ref(false)
const otherValue = ref('')

// Computed
const gridClass = computed(() => {
  const count = props.question.options.length + 1 // +1 for "Other" option
  if (count <= 2) return 'grid-cols-2'
  if (count <= 3) return 'grid-cols-1 sm:grid-cols-3'
  return 'grid-cols-1 sm:grid-cols-2'
})

const canSubmit = computed(() => {
  if (props.question.type === 'single') {
    if (showOtherInput.value) {
      return otherValue.value.trim().length > 0
    }
    return selected.value !== null
  }
  return multiSelected.value.length > 0
})

// Methods
function selectSingle(value: string) {
  selected.value = value
  showOtherInput.value = false
  otherValue.value = ''
}

function enableOtherInput() {
  showOtherInput.value = true
  selected.value = null
}

function toggleMulti(value: string) {
  const idx = multiSelected.value.indexOf(value)
  if (idx === -1) {
    // Special case: if selecting "none", clear others
    if (value === 'none') {
      multiSelected.value = ['none']
    }
    else {
      // Remove "none" if selecting something else
      multiSelected.value = multiSelected.value.filter(v => v !== 'none')
      multiSelected.value.push(value)
    }
  }
  else {
    multiSelected.value.splice(idx, 1)
  }
}

function submit() {
  if (props.question.type === 'single') {
    if (showOtherInput.value && otherValue.value.trim()) {
      emit('select', `other:${otherValue.value.trim()}`)
    }
    else if (selected.value) {
      emit('select', selected.value)
    }
  }
  else if (props.question.type === 'multi' && multiSelected.value.length > 0) {
    emit('select', [...multiSelected.value])
  }
}

// Reset when question changes
watch(() => props.question.id, () => {
  selected.value = null
  multiSelected.value = []
  showOtherInput.value = false
  otherValue.value = ''
})
</script>
