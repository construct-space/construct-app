<script setup lang="ts">
import { ref } from 'vue'

const props = defineProps<{
  data: {
    questions: Array<{
      id: string
      question: string
      type: 'single' | 'multi'
      options: Array<{ value: string; label: string; description?: string }>
    }>
  }
}>()

const emit = defineEmits<{
  answer: [questionId: string, value: string | string[]]
}>()

const selections = ref<Record<string, string | string[]>>({})
const submitted = ref<Record<string, boolean>>({})
const showOtherInput = ref<Record<string, boolean>>({})
const otherText = ref<Record<string, string>>({})

function isOtherOption(value: string): boolean {
  return value.toLowerCase() === 'other' || value.toLowerCase().startsWith('other')
}

function select(questionId: string, value: string, type: 'single' | 'multi') {
  if (submitted.value[questionId]) return
  const v = value.trim()

  // "Other" option → show text input instead of submitting
  if (isOtherOption(v)) {
    showOtherInput.value[questionId] = true
    if (type === 'multi') {
      toggleMulti(questionId, v)
      if (!(selections.value[questionId] as string[] || []).includes(v)) {
        showOtherInput.value[questionId] = false
      }
    }
    return
  }

  if (type === 'multi') {
    toggleMulti(questionId, v)
  } else {
    selections.value[questionId] = v
    submitted.value[questionId] = true
    emit('answer', questionId, v)
  }
}

function toggleMulti(questionId: string, value: string) {
  const current = [...((selections.value[questionId] as string[]) || [])]
  const idx = current.indexOf(value)
  if (idx >= 0) {
    current.splice(idx, 1)
  } else {
    current.push(value)
  }
  // Force reactivity by assigning a new object
  selections.value = { ...selections.value, [questionId]: current }
}

function submitOther(questionId: string, type: 'single' | 'multi') {
  const text = (otherText.value[questionId] || '').trim()
  if (!text) return

  if (type === 'single') {
    submitted.value[questionId] = true
    emit('answer', questionId, text)
  } else {
    // Add custom text to multi selections, remove the "other" placeholder
    const current = (selections.value[questionId] as string[]) || []
    selections.value[questionId] = [...current.filter(v => !isOtherOption(v)), text]
    showOtherInput.value[questionId] = false
  }
}

function submitMulti(questionId: string) {
  const selected = (selections.value[questionId] as string[]) || []
  if (selected.length === 0) return
  submitted.value[questionId] = true
  emit('answer', questionId, selected)
}

function isSelected(questionId: string, value: string): boolean {
  const sel = selections.value[questionId]
  return Array.isArray(sel) ? sel.includes(value) : sel === value
}

function multiCount(questionId: string): number {
  const sel = selections.value[questionId]
  return Array.isArray(sel) ? sel.length : 0
}

function handleOtherKeydown(e: KeyboardEvent, questionId: string, type: 'single' | 'multi') {
  if (e.key === 'Enter') {
    e.preventDefault()
    submitOther(questionId, type)
  }
}
</script>

<template>
  <div class="space-y-3 my-2">
    <div v-for="q in data.questions" :key="q.id" class="rounded-lg border border-app-border p-3" :class="submitted[q.id] ? 'opacity-60' : ''">
      <div class="flex items-center gap-2 mb-2">
        <p class="text-sm font-medium text-app">{{ q.question }}</p>
        <span v-if="q.type === 'multi'" class="text-[10px] text-app-muted px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-500">select multiple</span>
      </div>
      <div class="flex flex-wrap gap-2">
        <button
          v-for="opt in q.options"
          :key="opt.value"
          class="px-3 py-1.5 text-xs rounded-md border transition-colors text-left"
          :class="[
            submitted[q.id] ? 'cursor-default' : 'cursor-pointer',
            isSelected(q.id, opt.value)
              ? 'border-blue-500 bg-blue-500/10 text-blue-500'
              : submitted[q.id]
                ? 'border-app-border/50 text-app-muted/50'
                : 'border-app-border text-app-muted hover:border-blue-500/50'
          ]"
          @click="select(q.id, opt.value, q.type)"
        >
          {{ opt.label }}
          <span v-if="opt.description" class="block text-[10px] opacity-70 mt-0.5">{{ opt.description }}</span>
        </button>
      </div>

      <!-- Other text input -->
      <div v-if="showOtherInput[q.id] && !submitted[q.id]" class="mt-2 flex gap-2">
        <input
          v-model="otherText[q.id]"
          type="text"
          placeholder="Type your answer..."
          class="flex-1 px-3 py-1.5 text-xs rounded-md border border-app-border bg-transparent text-app placeholder:text-app-muted/50 focus:outline-none focus:border-app-accent"
          @keydown="handleOtherKeydown($event, q.id, q.type)"
        />
        <button
          class="px-3 py-1.5 text-xs rounded-md bg-blue-500 text-white hover:bg-blue-600"
          @click="submitOther(q.id, q.type)"
        >
          {{ q.type === 'multi' ? 'Add' : 'Submit' }}
        </button>
      </div>

      <!-- Confirm button for multi-select -->
      <div v-if="q.type === 'multi' && !submitted[q.id]" class="mt-3 flex items-center gap-2">
        <button
          class="px-4 py-1.5 text-xs rounded-md font-medium transition-colors"
          :class="multiCount(q.id) > 0
            ? 'bg-blue-500 text-white hover:bg-blue-600'
            : 'bg-[var(--app-border)]/30 text-[var(--app-muted)] cursor-not-allowed'"
          @click="submitMulti(q.id)"
        >
          Confirm ({{ multiCount(q.id) }} selected)
        </button>
      </div>
    </div>
  </div>
</template>
