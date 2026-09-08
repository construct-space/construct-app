<script setup lang="ts">
import { ref, onMounted, onUnmounted } from "vue";

interface ShortcutGroup {
  title: string;
  shortcuts: Array<{ keys: string; description: string }>;
}

const isOpen = ref(false);

const shortcuts: ShortcutGroup[] = [
  {
    title: "Navigation",
    shortcuts: [
      { keys: "Cmd+L", description: "Focus address bar" },
      { keys: "Cmd+[", description: "Back" },
      { keys: "Cmd+]", description: "Forward" },
      { keys: "Cmd+R", description: "Reload page" },
      { keys: "Cmd+Shift+R", description: "Hard reload (clear cache)" },
    ],
  },
  {
    title: "Tabs",
    shortcuts: [
      { keys: "Cmd+T", description: "New tab" },
      { keys: "Cmd+W", description: "Close tab" },
      { keys: "Cmd+Shift+T", description: "Reopen closed tab" },
      { keys: "Cmd+Tab", description: "Next tab" },
      { keys: "Cmd+Shift+Tab", description: "Previous tab" },
      { keys: "Cmd+1 to Cmd+8", description: "Jump to tab" },
      { keys: "Cmd+9", description: "Jump to last tab" },
    ],
  },
  {
    title: "Search & Find",
    shortcuts: [
      { keys: "Cmd+F", description: "Find in page" },
      { keys: "Cmd+G", description: "Find next" },
      { keys: "Cmd+Shift+G", description: "Find previous" },
    ],
  },
  {
    title: "Zoom",
    shortcuts: [
      { keys: "Cmd+=", description: "Zoom in" },
      { keys: "Cmd+-", description: "Zoom out" },
      { keys: "Cmd+0", description: "Reset zoom" },
    ],
  },
  {
    title: "Bookmarks & Downloads",
    shortcuts: [
      { keys: "Cmd+D", description: "Bookmark current page" },
      { keys: "Cmd+Shift+Y", description: "Open downloads" },
    ],
  },
  {
    title: "Developer",
    shortcuts: [
      { keys: "Cmd+Option+I", description: "Toggle DevTools" },
    ],
  },
];

function closeModal() {
  isOpen.value = false;
}

function handleKeyDown(event: KeyboardEvent) {
  if (event.key === "?" && !event.ctrlKey && !event.metaKey && !event.altKey) {
    isOpen.value = !isOpen.value;
  } else if (event.key === "Escape" && isOpen.value) {
    closeModal();
  }
}

onMounted(() => {
  window.addEventListener("keydown", handleKeyDown);
});

onUnmounted(() => {
  window.removeEventListener("keydown", handleKeyDown);
});
</script>

<template>
  <!-- Task 36: Keyboard shortcuts help accessible via ? key -->
  <div
    v-if="isOpen"
    class="keyboard-help-overlay"
    role="dialog"
    aria-modal="true"
    aria-labelledby="shortcuts-title"
    @click.self="closeModal"
  >
    <div class="keyboard-help-modal">
      <div class="modal-header">
        <h2 id="shortcuts-title">Keyboard Shortcuts</h2>
        <button
          class="close-btn"
          aria-label="Close keyboard shortcuts"
          @click="closeModal"
        >
          ✕
        </button>
      </div>

      <div class="modal-content">
        <div
          v-for="group in shortcuts"
          :key="group.title"
          class="shortcut-group"
        >
          <h3>{{ group.title }}</h3>
          <div class="shortcut-list">
            <div
              v-for="shortcut in group.shortcuts"
              :key="shortcut.keys"
              class="shortcut-item"
            >
              <kbd class="shortcut-keys">{{ shortcut.keys }}</kbd>
              <span class="shortcut-desc">{{ shortcut.description }}</span>
            </div>
          </div>
        </div>
      </div>

      <div class="modal-footer">
        <p class="hint">Press <kbd>?</kbd> to toggle this help, <kbd>Esc</kbd> to close</p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.keyboard-help-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.7);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 2000;
  animation: fadeIn 0.2s ease;
}

@keyframes fadeIn {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}

.keyboard-help-modal {
  background: var(--app-surface);
  border: 1px solid var(--app-border);
  border-radius: 12px;
  width: 90%;
  max-width: 700px;
  max-height: 80vh;
  display: flex;
  flex-direction: column;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
}

.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 20px 24px;
  border-bottom: 1px solid var(--app-border);
}

.modal-header h2 {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
  color: var(--app-foreground);
}

.close-btn {
  background: none;
  border: none;
  color: var(--app-muted);
  font-size: 24px;
  cursor: pointer;
  padding: 0;
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
  transition: background-color 0.2s, color 0.2s;
}

.close-btn:hover {
  background-color: var(--app-card-hover);
  color: var(--app-foreground);
}

.close-btn:focus {
  outline: 2px solid var(--app-accent);
  outline-offset: 2px;
}

.modal-content {
  flex: 1;
  overflow-y: auto;
  padding: 20px 24px;
}

.shortcut-group {
  margin-bottom: 24px;
}

.shortcut-group:last-child {
  margin-bottom: 0;
}

.shortcut-group h3 {
  margin: 0 0 12px 0;
  font-size: 13px;
  font-weight: 600;
  color: var(--app-muted);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.shortcut-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.shortcut-item {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 13px;
  color: var(--app-foreground);
}

.shortcut-keys {
  background: var(--app-card-hover);
  border: 1px solid var(--app-border);
  border-radius: 4px;
  padding: 4px 8px;
  font-family: "Menlo", "Monaco", "Courier New", monospace;
  font-size: 11px;
  font-weight: 500;
  color: var(--app-foreground);
  white-space: nowrap;
  flex-shrink: 0;
  min-width: 100px;
  text-align: center;
}

.shortcut-desc {
  color: var(--app-muted);
}

.modal-footer {
  padding: 16px 24px;
  border-top: 1px solid var(--app-border);
  text-align: center;
}

.hint {
  margin: 0;
  font-size: 12px;
  color: var(--app-muted);
}

.hint kbd {
  background: var(--app-card-hover);
  border: 1px solid var(--app-border);
  border-radius: 3px;
  padding: 2px 6px;
  font-family: "Menlo", "Monaco", "Courier New", monospace;
  font-size: 11px;
}

/* Scrollbar styling */
.modal-content::-webkit-scrollbar {
  width: 8px;
}

.modal-content::-webkit-scrollbar-track {
  background: transparent;
}

.modal-content::-webkit-scrollbar-thumb {
  background: color-mix(in srgb, var(--app-foreground) 16%, transparent);
  border-radius: 4px;
}

.modal-content::-webkit-scrollbar-thumb:hover {
  background: color-mix(in srgb, var(--app-foreground) 24%, transparent);
}
</style>
