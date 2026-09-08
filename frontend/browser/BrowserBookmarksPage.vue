<template>
  <div class="bookmarks-page">
    <div class="header">
      <h1>Bookmarks</h1>
      <input
        v-model="searchQuery"
        type="text"
        placeholder="Search bookmarks..."
        class="search-input"
      />
    </div>
    <div class="content">
      <div v-if="filteredBookmarks.length === 0" class="empty-state">
        <p>No bookmarks yet. Add one with Cmd+D while browsing.</p>
      </div>
      <div v-for="bookmark in filteredBookmarks" :key="bookmark.id" class="bookmark-row">
        <img
          v-if="bookmark.favicon"
          :src="bookmark.favicon"
          class="favicon"
          alt=""
        />
        <div v-else class="favicon-placeholder" />
        <a :href="bookmark.url" class="title">{{ bookmark.title }}</a>
        <span class="url">{{ bookmark.url }}</span>
        <template v-if="pendingDeleteId === bookmark.id">
          <button @click="confirmRemove(bookmark.id)" class="delete-btn confirm" title="Confirm remove">
            Remove
          </button>
          <button @click="pendingDeleteId = null" class="delete-btn" title="Cancel">
            ×
          </button>
        </template>
        <button
          v-else
          @click="pendingDeleteId = bookmark.id"
          class="delete-btn"
          title="Remove bookmark"
        >
          ×
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { useBrowserBookmarksStore } from '@/stores/browserBookmarks'

const bookmarksStore = useBrowserBookmarksStore()
const searchQuery = ref('')
// Inline two-step confirm — window.confirm() is intercepted by Tauri and
// throws (dialog.confirm not allowed) in the desktop webview.
const pendingDeleteId = ref<string | null>(null)

const filteredBookmarks = computed(() => {
  const query = searchQuery.value.toLowerCase()
  return bookmarksStore.bookmarks
    .filter(b => b.folderId === null) // Only root level
    .filter(
      b =>
        b.title.toLowerCase().includes(query) || b.url.toLowerCase().includes(query),
    )
})

function confirmRemove(id: string) {
  bookmarksStore.removeBookmark(id)
  pendingDeleteId.value = null
}
</script>

<style scoped>
.bookmarks-page {
  padding: 20px;
  color: var(--app-foreground);
  background: var(--app-background);
  min-height: 100vh;
}

.header {
  margin-bottom: 20px;
  display: flex;
  align-items: center;
  gap: 16px;
}

.header h1 {
  margin: 0;
  font-size: 24px;
  font-weight: 600;
}

.search-input {
  padding: 8px 12px;
  background: var(--app-surface);
  border: 1px solid var(--app-border);
  color: var(--app-foreground);
  border-radius: 4px;
  font-size: 14px;
  flex: 1;
  max-width: 300px;
}

.search-input:focus {
  outline: none;
  border-color: color-mix(in srgb, var(--app-foreground) 16%, transparent);
  box-shadow: 0 0 0 2px rgba(122, 211, 252, 0.1);
}

.content {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.empty-state {
  padding: 40px 20px;
  text-align: center;
  color: var(--app-muted);
}

.bookmark-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px;
  background: var(--app-background);
  border-radius: 4px;
  border: 1px solid var(--app-border);
  transition: background 0.15s ease;
}

.bookmark-row:hover {
  background: var(--app-card-hover);
  border-color: var(--app-border);
}

.favicon {
  width: 16px;
  height: 16px;
  flex-shrink: 0;
}

.favicon-placeholder {
  width: 16px;
  height: 16px;
  flex-shrink: 0;
  background: var(--app-border);
  border-radius: 2px;
}

.title {
  color: var(--app-accent);
  text-decoration: none;
  flex-shrink: 0;
  max-width: 300px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 500;
}

.title:hover {
  text-decoration: underline;
}

.url {
  color: var(--app-muted);
  font-size: 12px;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: 'Monaco', 'Courier New', monospace;
}

.delete-btn {
  background: transparent;
  border: none;
  color: var(--app-muted);
  width: 24px;
  height: 24px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 18px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.15s ease;
}

.delete-btn:hover {
  background: var(--app-border);
  color: var(--app-foreground);
}

.delete-btn.confirm {
  width: auto;
  padding: 0 10px;
  font-size: 12px;
  font-weight: 600;
  color: #f87171;
}

.delete-btn.confirm:hover {
  background: rgba(248, 113, 113, 0.15);
  color: #fca5a5;
}
</style>
