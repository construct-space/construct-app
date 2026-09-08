<template>
  <div v-if="showFind" class="find-bar">
    <input
      ref="inputRef"
      v-model="searchText"
      type="text"
      placeholder="Find in page..."
      class="find-input"
      @keydown.enter="$emit('next')"
      @keydown.escape="$emit('close')"
    />
    <span class="find-results">{{ resultsText }}</span>
    <button class="find-btn" title="Previous match (Shift+Enter)" @click="$emit('prev')">↑</button>
    <button class="find-btn" title="Next match (Enter)" @click="$emit('next')">↓</button>
    <button class="find-btn close-btn" title="Close (Esc)" @click="$emit('close')">✕</button>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch, nextTick } from 'vue'

const props = defineProps<{
  showFind: boolean
  matchCount?: number
  activeIndex?: number
}>()

const emit = defineEmits<{
  close: []
  search: [text: string]
  prev: []
  next: []
}>()

const inputRef = ref<HTMLInputElement | null>(null)
const searchText = ref('')

const resultsText = computed(() => {
  if (!props.matchCount) return 'No results'
  return `${(props.activeIndex ?? 0) + 1} of ${props.matchCount}`
})

watch(
  () => props.showFind,
  async (show) => {
    if (show) {
      searchText.value = ''
      await nextTick()
      inputRef.value?.focus()
    }
  }
)

watch(searchText, (text) => {
  emit('search', text)
})
</script>

<style scoped>
.find-bar {
  position: fixed;
  bottom: 16px;
  right: 16px;
  background: var(--app-surface);
  border: 1px solid var(--app-border);
  border-radius: 10px;
  padding: 8px 12px;
  display: flex;
  gap: 8px;
  align-items: center;
  box-shadow: 0 8px 24px -8px rgba(0, 0, 0, 0.3);
  z-index: 1000;
  font-family: system-ui, -apple-system, sans-serif;
}

.find-input {
  background: var(--app-input-bg);
  border: 1px solid var(--app-border);
  color: var(--app-foreground);
  padding: 6px 8px;
  border-radius: 6px;
  min-width: 200px;
  font-size: 13px;
  outline: none;
  transition: border-color 0.12s ease, box-shadow 0.12s ease;
}

.find-input:focus {
  border-color: var(--app-accent);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--app-accent) 22%, transparent);
}

.find-input::placeholder {
  color: var(--app-muted);
}

.find-btn {
  background: color-mix(in srgb, var(--app-foreground) 6%, transparent);
  color: var(--app-foreground);
  border: 1px solid var(--app-border);
  padding: 6px 10px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 13px;
  line-height: 1;
  transition: background-color 0.15s;
}

.find-btn:hover {
  background: color-mix(in srgb, var(--app-foreground) 10%, transparent);
}

.find-btn:active {
  background: color-mix(in srgb, var(--app-foreground) 14%, transparent);
}

.close-btn {
  width: 24px;
  padding: 6px;
}

.find-results {
  color: var(--app-muted);
  font-size: 13px;
  min-width: 80px;
  text-align: center;
  white-space: nowrap;
}
</style>
