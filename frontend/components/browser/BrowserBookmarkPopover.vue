<template>
  <div v-if="show" class="bookmark-popover" @click.self="cancel">
    <div class="popover-content">
      <h3>Save Bookmark</h3>
      <input
        v-model="bookmarkTitle"
        type="text"
        placeholder="Title"
        class="input"
      />
      <input
        v-model="bookmarkUrl"
        type="text"
        placeholder="URL"
        class="input"
        disabled
      />
      <select v-model="folderId" class="input">
        <option value="null">Unsorted</option>
        <option v-for="folder in folders" :key="folder.id" :value="folder.id">
          {{ folder.title }}
        </option>
      </select>
      <div class="buttons">
        <button @click="save">Save</button>
        <button @click="cancel">Cancel</button>
      </div>
      <div v-if="isAlreadyBookmarked" class="already-bookmarked">
        Already bookmarked ✓
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useBrowserBookmarksStore } from '@/stores/browserBookmarks'

const props = defineProps<{
  show: boolean
  title: string
  url: string
  favicon: string | null
}>()

const emit = defineEmits<{
  close: []
  save: [{ title: string; url: string; folderId: string | null }]
}>()

const bookmarksStore = useBrowserBookmarksStore()
bookmarksStore.initFolders()

const bookmarkTitle = ref('')
const bookmarkUrl = ref('')
const folderId = ref<string | null>('null')
const folders = computed(() => bookmarksStore.folders)
const isAlreadyBookmarked = computed(() => bookmarksStore.isBookmarked(bookmarkUrl.value))

watch(
  () => props.show,
  (show) => {
    if (show) {
      bookmarkTitle.value = props.title
      bookmarkUrl.value = props.url
      folderId.value = 'null'
    }
  },
  { flush: 'sync' }
)

function save() {
  bookmarksStore.addBookmark({
    title: bookmarkTitle.value || props.title,
    url: props.url,
    favicon: props.favicon,
    folderId: folderId.value === 'null' ? null : folderId.value,
  })
  emit('save', {
    title: bookmarkTitle.value,
    url: props.url,
    folderId: folderId.value === 'null' ? null : folderId.value,
  })
  emit('close')
}

function cancel() {
  emit('close')
}
</script>

<style scoped>
.bookmark-popover {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 2000;
}

.popover-content {
  background: var(--app-surface);
  border: 1px solid var(--app-border);
  border-radius: 8px;
  padding: 20px;
  min-width: 300px;
  color: var(--app-foreground);
}

.popover-content h3 {
  margin: 0 0 16px 0;
  font-size: 16px;
}

.input {
  width: 100%;
  padding: 8px 12px;
  background: var(--app-background);
  border: 1px solid var(--app-border);
  color: var(--app-foreground);
  border-radius: 4px;
  margin-bottom: 12px;
  font-size: 13px;
  box-sizing: border-box;
}

.input:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.buttons {
  display: flex;
  gap: 8px;
  margin-top: 16px;
}

button {
  flex: 1;
  padding: 8px 16px;
  background: var(--app-accent);
  color: var(--app-accent-foreground);
  border: 1px solid transparent;
  border-radius: 6px;
  cursor: pointer;
  transition: filter 0.15s ease, background 0.15s ease;
}

button:last-child {
  background: var(--app-surface);
  color: var(--app-foreground);
  border-color: var(--app-border);
}

button:hover {
  filter: brightness(1.06);
}

.already-bookmarked {
  margin-top: 12px;
  padding: 8px;
  background: color-mix(in srgb, var(--app-accent) 14%, transparent);
  border-left: 2px solid var(--app-accent);
  color: var(--app-accent);
  font-size: 12px;
}
</style>
