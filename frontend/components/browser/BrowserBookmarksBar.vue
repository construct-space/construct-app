<template>
  <div class="bookmarks-bar">
    <button
      v-for="bookmark in visibleBookmarks"
      :key="bookmark.id"
      class="bookmark-btn"
      :title="bookmark.title"
      @click="navigateToBookmark(bookmark.url)"
      @contextmenu.prevent="showBookmarkContextMenu(bookmark, $event)"
    >
      <img v-if="bookmark.favicon" :src="bookmark.favicon" class="favicon" alt="" />
      <span class="label">{{ bookmark.title }}</span>
    </button>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useBrowserBookmarksStore } from '@/stores/browserBookmarks'
import { showContextMenu } from '@/composables/useNativeContextMenu'
import type { Bookmark } from '@/stores/browserBookmarks'

const props = defineProps<{
  onNavigate: (url: string) => void
  onOpenNewTab: (url: string) => void
}>()

const bookmarksStore = useBrowserBookmarksStore()

const visibleBookmarks = computed(() => {
  const root = bookmarksStore.getBookmarksByFolder(null)
  return root.slice(0, 10)
})

function navigateToBookmark(url: string) {
  props.onNavigate(url)
}

async function showBookmarkContextMenu(bookmark: Bookmark, event: MouseEvent) {
  const bounds = {
    x: event.clientX,
    y: event.clientY,
  }

  await showContextMenu(
    [
      [
        {
          label: 'Open',
          onSelect: () => navigateToBookmark(bookmark.url),
        },
        {
          label: 'Open in New Tab',
          onSelect: () => props.onOpenNewTab(bookmark.url),
        },
      ],
      [
        {
          label: 'Remove',
          onSelect: () => bookmarksStore.removeBookmark(bookmark.id),
        },
      ],
    ],
    bounds,
  )
}
</script>

<style scoped>
.bookmarks-bar {
  height: 32px;
  background: var(--app-background);
  border-bottom: 1px solid var(--app-border);
  display: flex;
  gap: 4px;
  padding: 0 8px;
  overflow-x: auto;
  align-items: center;
}

.bookmark-btn {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  background: var(--app-surface);
  border: 1px solid var(--app-border);
  border-radius: 6px;
  color: var(--app-foreground);
  cursor: pointer;
  white-space: nowrap;
  font-size: 12px;
  min-width: fit-content;
  transition: background 0.15s ease, border-color 0.15s ease;
}

.bookmark-btn:hover {
  background: var(--app-card-hover);
  border-color: color-mix(in srgb, var(--app-foreground) 16%, transparent);
}

.favicon {
  width: 16px;
  height: 16px;
  flex-shrink: 0;
}

.label {
  max-width: 100px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
