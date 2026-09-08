<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from "vue";

interface Suggestion {
  id: string;
  title: string;
  url: string;
  source: "history" | "bookmark" | "url-completion";
  score: number;
}

const props = defineProps<{
  suggestions: Suggestion[];
  address: string;
}>();

const emit = defineEmits<{
  select: [suggestion: Suggestion];
  close: [];
}>();

const selectedIndex = ref(0);

const sortedSuggestions = computed(() => {
  // Task 33: Rank by source first (bookmarks > history), then by score
  return [...props.suggestions].sort((a, b) => {
    // Bookmarks first
    if (a.source === "bookmark" && b.source !== "bookmark") return -1;
    if (a.source !== "bookmark" && b.source === "bookmark") return 1;

    // Within same source, sort by score (higher score first)
    return b.score - a.score;
  });
});

function getIcon(suggestion: Suggestion): string {
  switch (suggestion.source) {
    case "bookmark":
      return "🔖";
    case "url-completion":
      return "🔗";
    case "history":
    default:
      return "⏱️";
  }
}

function selectSuggestion(suggestion: Suggestion) {
  emit("select", suggestion);
}

function onKeyDown(event: KeyboardEvent) {
  if (event.key === "ArrowDown") {
    event.preventDefault();
    selectedIndex.value = Math.min(
      selectedIndex.value + 1,
      sortedSuggestions.value.length - 1
    );
  } else if (event.key === "ArrowUp") {
    event.preventDefault();
    selectedIndex.value = Math.max(selectedIndex.value - 1, 0);
  } else if (event.key === "Enter") {
    event.preventDefault();
    const suggestion = sortedSuggestions.value[selectedIndex.value];
    if (suggestion) {
      selectSuggestion(suggestion);
    }
  }
}

onMounted(() => {
  window.addEventListener("keydown", onKeyDown);
});

onUnmounted(() => {
  window.removeEventListener("keydown", onKeyDown);
});
</script>

<template>
  <div
    class="suggestions-dropdown"
    role="listbox"
    aria-label="Address bar suggestions"
  >
    <ul class="suggestions-list" role="presentation">
      <li
        v-for="(suggestion, idx) in sortedSuggestions"
        :key="suggestion.id"
        class="suggestion-item"
        :class="{ 'suggestion-item--selected': idx === selectedIndex }"
        role="option"
        :aria-selected="idx === selectedIndex"
        :tabindex="idx === selectedIndex ? 0 : -1"
        @click="selectSuggestion(suggestion)"
        @mouseenter="selectedIndex = idx"
      >
        <span class="suggestion-icon" aria-hidden="true">{{ getIcon(suggestion) }}</span>
        <div class="suggestion-content">
          <div class="suggestion-title">{{ suggestion.title }}</div>
          <div class="suggestion-url">{{ suggestion.url }}</div>
        </div>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.suggestions-dropdown {
  position: absolute;
  top: 100%;
  left: 0;
  right: 0;
  background: var(--app-surface);
  border: 1px solid var(--app-border);
  border-top: none;
  border-radius: 0 0 18px 18px;
  max-height: 300px;
  overflow-y: auto;
  z-index: 1000;
  margin-top: -1px;
  box-shadow: 0 12px 28px -10px rgba(0, 0, 0, 0.25);
}

.suggestions-list {
  list-style: none;
  padding: 4px 0;
  margin: 0;
}

.suggestion-item {
  padding: 8px 14px;
  display: flex;
  gap: 8px;
  align-items: flex-start;
  cursor: pointer;
  color: var(--app-foreground);
  transition: background-color 0.15s ease;
}

.suggestion-item:hover,
.suggestion-item--selected {
  background: var(--app-card-hover);
}

.suggestion-icon {
  flex-shrink: 0;
  font-size: 14px;
  display: flex;
  align-items: center;
}

.suggestion-content {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.suggestion-title {
  font-size: 13px;
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.suggestion-url {
  font-size: 12px;
  color: var(--app-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
