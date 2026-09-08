<template>
  <div class="downloads-page">
    <div class="header">
      <h1>Downloads</h1>
      <button
        v-if="downloads.length > 0"
        @click="clearCompleted"
        class="clear-btn"
      >
        Clear Completed
      </button>
    </div>
    <div class="content">
      <div v-if="downloads.length === 0" class="empty-state">
        <p>No downloads yet.</p>
      </div>
      <div v-for="download in downloads" :key="download.id" class="download-row">
        <div class="info">
          <div class="filename">{{ download.filename }}</div>
          <div class="url">{{ download.url }}</div>
        </div>
        <div class="status">
          <div v-if="download.status === 'downloading'" class="progress-bar">
            <div class="progress-fill" :style="{ width: download.progress + '%' }" />
          </div>
          <span class="status-text" :class="download.status">
            {{ formatStatus(download.status, download.progress) }}
          </span>
        </div>
        <div class="size">{{ formatSize(download.size) }}</div>
        <button
          @click="removeDownload(download.id)"
          class="remove-btn"
          title="Remove from list"
        >
          ×
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useBrowserDownloadsStore } from '@/stores/browserDownloads'

const downloadsStore = useBrowserDownloadsStore()

const downloads = downloadsStore.downloads

function formatStatus(status: string, progress: number): string {
  switch (status) {
    case 'downloading':
      return `Downloading (${progress}%)`
    case 'completed':
      return 'Completed'
    case 'failed':
      return 'Failed'
    case 'paused':
      return 'Paused'
    default:
      return status
  }
}

function formatSize(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB']
  let size = bytes
  let unitIndex = 0

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024
    unitIndex++
  }

  return `${size.toFixed(1)} ${units[unitIndex]}`
}

function removeDownload(id: string) {
  downloadsStore.remove(id)
}

function clearCompleted() {
  downloadsStore.clear()
}
</script>

<style scoped>
.downloads-page {
  padding: 20px;
  color: var(--app-foreground);
  background: var(--app-background);
  min-height: 100vh;
}

.header {
  margin-bottom: 20px;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.header h1 {
  margin: 0;
  font-size: 24px;
  font-weight: 600;
}

.clear-btn {
  padding: 8px 12px;
  background: var(--app-surface);
  border: 1px solid var(--app-border);
  color: var(--app-foreground);
  border-radius: 4px;
  cursor: pointer;
  font-size: 14px;
  transition: all 0.15s ease;
}

.clear-btn:hover {
  background: var(--app-card-hover);
  border-color: color-mix(in srgb, var(--app-foreground) 16%, transparent);
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

.download-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px;
  background: var(--app-background);
  border-radius: 4px;
  border: 1px solid var(--app-border);
  transition: background 0.15s ease;
}

.download-row:hover {
  background: var(--app-card-hover);
  border-color: var(--app-border);
}

.info {
  flex: 1;
  min-width: 0;
}

.filename {
  color: var(--app-foreground);
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.url {
  color: var(--app-muted);
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: 'Monaco', 'Courier New', monospace;
}

.status {
  flex: 0 0 200px;
}

.progress-bar {
  height: 4px;
  background: var(--app-surface);
  border-radius: 2px;
  overflow: hidden;
  margin-bottom: 4px;
}

.progress-fill {
  height: 100%;
  background: var(--app-accent);
  transition: width 0.3s ease;
}

.status-text {
  display: block;
  font-size: 12px;
  color: var(--app-muted);
}

.status-text.completed {
  color: #86efac;
}

.status-text.failed {
  color: #fca5a5;
}

.status-text.paused {
  color: #fbbf24;
}

.size {
  flex: 0 0 80px;
  text-align: right;
  color: var(--app-muted);
  font-size: 12px;
  font-family: 'Monaco', 'Courier New', monospace;
}

.remove-btn {
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
  flex-shrink: 0;
}

.remove-btn:hover {
  background: var(--app-border);
  color: var(--app-foreground);
}
</style>
