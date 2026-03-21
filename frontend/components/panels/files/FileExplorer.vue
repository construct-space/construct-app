<script setup lang="ts">
/**
 * File Explorer Panel - Browse and select files from filesystem
 * Ported from construct-mono (Nuxt) to Vue/Vite
 */
import { FileTreeContextKey, type FileEntry } from './fileTreeContext'
import { openContextMenu } from '~/composables/useContextMenus'
// Space composable provided at runtime by IIFE bundle
const useCodeEditor = (() => ({
  state: { rootPath: '', currentFile: '', fileContent: '', currentLanguage: '', fileTree: [] as FileEntry[], expandedFolders: new Set<string>(), selectedFile: null as string | null, isDirty: false, isLoading: false, originalContent: '' },
  openFolder: () => {}, loadDirectory: (_path: string) => Promise.resolve(), selectFile: (_entry: FileEntry) => Promise.resolve(),
  getFileIcon: (_entry: FileEntry) => 'i-lucide-file', getFileIconColor: (_entry: FileEntry) => '', initTauri: () => {},
  deleteEntry: (_path: string, _isDir: boolean) => Promise.resolve(false), renameEntry: (_old: string, _new: string) => Promise.resolve(false),
  duplicateEntry: (_path: string) => Promise.resolve(false),
  copyPath: (_path: string) => Promise.resolve(false), copyRelativePath: (_path: string) => Promise.resolve(false),
  copyName: (_path: string) => Promise.resolve(false),
  revealInFinder: (_path: string) => Promise.resolve(false), openInTerminal: (_path: string) => Promise.resolve(false),
  createFile: (_parent: string, _name: string) => Promise.resolve(false), createFolder: (_parent: string, _name: string) => Promise.resolve(false),
}))

const {
  state,
  openFolder,
  loadDirectory,
  selectFile,
  getFileIcon,
  getFileIconColor,
  initTauri,
  // File operations for context menu
  deleteEntry,
  renameEntry,
  duplicateEntry,
  copyPath,
  copyRelativePath,
  copyName,
  revealInFinder,
  openInTerminal,
  createFile,
  createFolder,
} = useCodeEditor()

const projectStore = useProjectStore()

// State for root-level file/folder creation
const isCreatingRoot = ref<'file' | 'folder' | null>(null)
const createRootValue = ref('')
const createRootInput = ref<HTMLInputElement | null>(null)

// Start creating at root level
const startCreateRoot = (type: 'file' | 'folder') => {
  createRootValue.value = ''
  isCreatingRoot.value = type
  nextTick(() => {
    createRootInput.value?.focus()
  })
}

// Submit root create
const submitCreateRoot = async () => {
  if (createRootValue.value && state.rootPath) {
    if (isCreatingRoot.value === 'file') {
      await createFile(state.rootPath, createRootValue.value)
    } else if (isCreatingRoot.value === 'folder') {
      await createFolder(state.rootPath, createRootValue.value)
    }
  }
  isCreatingRoot.value = null
  createRootValue.value = ''
}

// Cancel root create
const cancelCreateRoot = () => {
  isCreatingRoot.value = null
  createRootValue.value = ''
}

// Root context menu (right-click on tree background)
const showRootContextMenu = async (e: MouseEvent) => {
  if (!state.rootPath) return
  e.preventDefault()

  await openContextMenu({
    sourceSpace: 'code',
    projectId: projectStore.currentProject?.id,
    target: {
      kind: 'folder',
      path: state.rootPath,
      name: state.rootPath.split('/').pop() || state.rootPath,
      projectId: projectStore.currentProject?.id,
    },
    items: [
      [
        { id: 'root-new-file', label: 'New File', onSelect: () => startCreateRoot('file') },
        { id: 'root-new-folder', label: 'New Folder', onSelect: () => startCreateRoot('folder') },
      ],
      [
        { id: 'root-copy-path', label: 'Copy Path', onSelect: () => copyPath(state.rootPath) },
        { id: 'root-open-terminal', label: 'Open in Terminal', onSelect: () => openInTerminal(state.rootPath) },
        { id: 'root-reveal', label: 'Reveal in Finder', onSelect: () => revealInFinder(state.rootPath) },
      ],
      [
        { id: 'root-refresh', label: 'Refresh', onSelect: () => loadDirectory(state.rootPath) },
      ],
    ],
  })
}

// Provide context for recursive FileTreeItem components
provide(FileTreeContextKey, {
  state,
  selectFile,
  getFileIcon,
  getFileIconColor,
  // File operations
  deleteEntry,
  renameEntry,
  duplicateEntry,
  copyPath,
  copyRelativePath,
  copyName,
  revealInFinder,
  openInTerminal,
  createFile,
  createFolder,
  loadDirectory,
})

// Auto-load from project local_path if no folder is open
onMounted(async () => {
  await initTauri()

  if (!state.rootPath) {
    const project = projectStore.currentProject
    if (project?.local_path) {
      await loadDirectory(project.local_path)
    }
  }
})
</script>

<template>
  <div class="h-full flex flex-col bg-app">
    <!-- Header -->
    <div class="p-2 flex items-center justify-between">
      <p class="text-[10px] font-semibold text-app-muted uppercase tracking-wider">Explorer</p>
      <div class="flex items-center gap-1">
        <button
          v-if="state.rootPath"
          class="p-1 rounded hover:bg-white/10 text-app-muted hover:text-app transition-colors"
          title="Refresh"
          @click="loadDirectory(state.rootPath)"
        >
          <Icon name="i-lucide-refresh-cw" class="size-3.5" />
        </button>
        <button
          v-if="state.rootPath"
          class="p-1 rounded hover:bg-white/10 text-app-muted hover:text-app transition-colors"
          title="New File"
          @click="startCreateRoot('file')"
        >
          <Icon name="i-lucide-file-plus" class="size-3.5" />
        </button>
        <button
          v-if="state.rootPath"
          class="p-1 rounded hover:bg-white/10 text-app-muted hover:text-app transition-colors"
          title="New Folder"
          @click="startCreateRoot('folder')"
        >
          <Icon name="i-lucide-folder-plus" class="size-3.5" />
        </button>
        <button
          class="p-1 rounded hover:bg-white/10 text-app-muted hover:text-app transition-colors"
          title="Open Folder"
          @click="openFolder"
        >
          <Icon name="i-lucide-folder-open" class="size-3.5" />
        </button>
      </div>
    </div>

    <!-- Content -->
    <div class="flex-1 overflow-y-auto">
      <!-- Empty state -->
      <div v-if="!state.rootPath" class="p-4 text-center">
        <Icon name="i-lucide-folder-open" class="size-12 text-app-muted mx-auto mb-3" />
        <p class="text-sm text-app-muted mb-3">No folder open</p>
        <Button
          icon="i-lucide-folder-open"
          label="Open Folder"
          size="sm"
          @click="openFolder"
        />
      </div>

      <!-- File tree with context menu on entire area -->
      <div v-else class="h-full" @contextmenu="showRootContextMenu">
        <div class="p-1 h-full min-h-full">
          <!-- Root folder name -->
          <div class="px-2 py-1 text-xs font-medium text-app truncate flex items-center gap-2 rounded hover:bg-white/5 cursor-pointer">
            <Icon name="i-vscode-icons-default-folder-opened" class="size-4" />
            {{ state.rootPath.split('/').pop() }}
          </div>

          <!-- Inline create at root level -->
          <div
            v-if="isCreatingRoot"
            class="flex items-center gap-1.5 px-2 py-1"
            :style="{ paddingLeft: '20px' }"
          >
            <Icon
              :name="isCreatingRoot === 'folder' ? 'i-lucide-folder-plus' : 'i-lucide-file-plus'"
              class="size-4 text-blue-400 shrink-0"
            />
            <input
              ref="createRootInput"
              v-model="createRootValue"
              :placeholder="isCreatingRoot === 'folder' ? 'Folder name...' : 'File name...'"
              class="text-xs bg-white/10 border border-app-accent/50 rounded px-1 py-0.5 outline-none flex-1 min-w-0 text-app"
              @keydown.enter="submitCreateRoot"
              @keydown.escape="cancelCreateRoot"
              @blur="submitCreateRoot"
            >
          </div>

          <!-- Loading state -->
          <div v-if="state.isLoading" class="flex items-center justify-center py-8">
            <Icon name="i-lucide-loader-2" class="size-5 animate-spin text-app-muted" />
          </div>

          <!-- File tree items -->
          <div v-else class="mt-1">
            <FileTreeItem
              v-for="entry in state.fileTree"
              :key="entry.path"
              :entry="entry"
              :depth="0"
            />
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
