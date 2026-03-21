<script setup lang="ts">
/**
 * ToolbarSearch - Toggleable search for toolbar
 * Starts as an icon, expands to input on click
 */

const { searchPlaceholder, hasSearchHandler, executeSearch } = useToolbar()

const query = ref('')
const isExpanded = ref(false)
const inputRef = ref<HTMLInputElement | null>(null)

function toggleSearch() {
  isExpanded.value = !isExpanded.value
  if (isExpanded.value) {
    nextTick(() => {
      inputRef.value?.focus()
    })
  } else {
    query.value = ''
  }
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' && hasSearchHandler.value) {
    executeSearch(query.value)
  } else if (e.key === 'Escape') {
    isExpanded.value = false
    query.value = ''
  }
}

function onBlur() {
  setTimeout(() => {
    if (!query.value) {
      isExpanded.value = false
    }
  }, 200)
}

onMounted(() => {
  const handleKeyboard = (e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
      e.preventDefault()
      toggleSearch()
    }
  }
  window.addEventListener('keydown', handleKeyboard)
  onUnmounted(() => {
    window.removeEventListener('keydown', handleKeyboard)
  })
})
</script>

<template>
  <div class="relative flex items-center">
    <Tooltip v-if="!isExpanded" text="Search (Cmd+K)">
      <button
        class="flex items-center justify-center w-7 h-7 rounded-lg text-app-muted hover:text-app hover:bg-white/5 transition-all duration-200"
        @click="toggleSearch"
      >
        <Icon name="i-lucide-search" class="size-4" />
      </button>
    </Tooltip>

    <div v-else class="flex items-center gap-1">
      <div class="relative flex items-center">
        <Icon name="i-lucide-search" class="absolute left-2 size-3.5 text-app-muted pointer-events-none" />
        <input
          ref="inputRef"
          v-model="query"
          type="text"
          :placeholder="searchPlaceholder"
          class="w-56 h-7 pl-7 pr-7 text-xs bg-white/5 border border-white/10 rounded-lg text-app placeholder:text-app-muted focus:outline-none focus:border-app-accent/50 focus:ring-1 focus:ring-app-accent/20 transition-all"
          @keydown="onKeydown"
          @blur="onBlur"
        >
        <button
          class="absolute right-1.5 flex items-center justify-center w-4 h-4 rounded text-app-muted hover:text-app transition-colors"
          @click="toggleSearch"
        >
          <Icon name="i-lucide-x" class="size-3" />
        </button>
      </div>
    </div>
  </div>
</template>
