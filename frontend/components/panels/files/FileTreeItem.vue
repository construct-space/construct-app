<script setup lang="ts">
/**
 * FileTreeItem - Recursive file tree item component
 * Uses injected context from FileExplorer to avoid re-calling useCodeEditor
 */
import { FileTreeContextKey, type FileEntry } from './fileTreeContext'
import { openContextMenu } from '~/composables/useContextMenus'

// Required for recursive component self-reference
defineOptions({
  name: 'FileTreeItem'
})

const props = defineProps<{
  entry: FileEntry
  depth: number
}>()

const projectStore = useProjectStore()

// Inject context from FileExplorer - this prevents stack overflow
// by not re-calling useCodeEditor() in every recursive instance
const ctx = inject(FileTreeContextKey)!
const {
  state,
  selectFile,
  getFileIcon,
  getFileIconColor,
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
} = ctx

// Rename state
const isRenaming = ref(false)
const renameValue = ref('')
const renameInput = ref<HTMLInputElement | null>(null)

// New file/folder state
const isCreating = ref<'file' | 'folder' | null>(null)
const createValue = ref('')
const createInput = ref<HTMLInputElement | null>(null)

// Delete confirmation state
const showDeleteConfirm = ref(false)
const isDeleting = ref(false)

// Start rename
const startRename = () => {
  renameValue.value = props.entry.name
  isRenaming.value = true
  nextTick(() => {
    renameInput.value?.focus()
    renameInput.value?.select()
  })
}

// Submit rename
const submitRename = async () => {
  if (renameValue.value && renameValue.value !== props.entry.name) {
    await renameEntry(props.entry.path, renameValue.value)
  }
  isRenaming.value = false
}

// Cancel rename
const cancelRename = () => {
  isRenaming.value = false
  renameValue.value = ''
}

// Start creating new file/folder
const startCreate = (type: 'file' | 'folder') => {
  // Expand the folder first so the input is visible
  if (props.entry.isDirectory && !state.expandedFolders.has(props.entry.path)) {
    state.expandedFolders.add(props.entry.path)
  }
  createValue.value = ''
  isCreating.value = type
  nextTick(() => {
    createInput.value?.focus()
  })
}

// Submit create
const submitCreate = async () => {
  if (createValue.value) {
    if (isCreating.value === 'file') {
      await createFile(props.entry.path, createValue.value)
    } else if (isCreating.value === 'folder') {
      await createFolder(props.entry.path, createValue.value)
    }
  }
  isCreating.value = null
  createValue.value = ''
}

// Cancel create
const cancelCreate = () => {
  isCreating.value = null
  createValue.value = ''
}

// Handle delete with confirmation
const handleDelete = () => {
  showDeleteConfirm.value = true
}

const confirmDelete = async () => {
  isDeleting.value = true
  try {
    await deleteEntry(props.entry.path, props.entry.isDirectory)
    showDeleteConfirm.value = false
  } finally {
    isDeleting.value = false
  }
}

// Context menu
const handleContextMenu = async (e: MouseEvent) => {
  e.preventDefault()
  e.stopPropagation()

  if (props.entry.isDirectory) {
    await openContextMenu({
      sourceSpace: 'code',
      projectId: projectStore.currentProject?.id,
      target: {
        kind: 'folder',
        path: props.entry.path,
        name: props.entry.name,
        projectId: projectStore.currentProject?.id,
      },
      items: [
        [
          { id: 'folder-new-file', label: 'New File', onSelect: () => startCreate('file') },
          { id: 'folder-new-folder', label: 'New Folder', onSelect: () => startCreate('folder') },
        ],
        [
          { id: 'folder-rename', label: 'Rename', onSelect: startRename },
          { id: 'folder-delete', label: 'Delete', onSelect: handleDelete },
        ],
        [
          { id: 'folder-copy-name', label: 'Copy Name', onSelect: () => copyName(props.entry.path) },
          { id: 'folder-copy-path', label: 'Copy Path', onSelect: () => copyPath(props.entry.path) },
          { id: 'folder-copy-relative-path', label: 'Copy Relative Path', onSelect: () => copyRelativePath(props.entry.path) },
        ],
        [
          { id: 'folder-open-terminal', label: 'Open in Terminal', onSelect: () => openInTerminal(props.entry.path) },
          {
            id: 'folder-refresh',
            label: 'Refresh',
            onSelect: () => {
              if (!state.rootPath) return
              return loadDirectory(state.rootPath)
            },
          },
          { id: 'folder-reveal', label: 'Reveal in Finder', onSelect: () => revealInFinder(props.entry.path) },
        ],
      ],
    })
  } else {
    await openContextMenu({
      sourceSpace: 'code',
      projectId: projectStore.currentProject?.id,
      target: {
        kind: 'file',
        path: props.entry.path,
        name: props.entry.name,
        extension: props.entry.name.includes('.') ? props.entry.name.split('.').pop() : undefined,
        projectId: projectStore.currentProject?.id,
      },
      items: [
        [
          { id: 'file-open', label: 'Open', onSelect: () => selectFile(props.entry) },
        ],
        [
          { id: 'file-rename', label: 'Rename', onSelect: startRename },
          { id: 'file-duplicate', label: 'Duplicate', onSelect: () => duplicateEntry(props.entry.path) },
          { id: 'file-delete', label: 'Delete', onSelect: handleDelete },
        ],
        [
          { id: 'file-copy-name', label: 'Copy Name', onSelect: () => copyName(props.entry.path) },
          { id: 'file-copy-path', label: 'Copy Path', onSelect: () => copyPath(props.entry.path) },
          { id: 'file-copy-relative-path', label: 'Copy Relative Path', onSelect: () => copyRelativePath(props.entry.path) },
        ],
        [
          { id: 'file-reveal', label: 'Reveal in Finder', onSelect: () => revealInFinder(props.entry.path) },
        ],
      ],
    })
  }
}
</script>

<template>
  <div>
    <!-- Main item -->
    <div
      class="flex items-center gap-1.5 px-2 py-1 rounded cursor-pointer"
      :class="state.selectedFile === entry.path
        ? 'bg-(--app-accent)/10 text-app-accent'
        : 'hover:bg-white/10 dark:hover:bg-white/5 text-app-muted hover:text-app-accent'"
      :style="{ paddingLeft: `${depth * 12 + 8}px` }"
      @click="selectFile(entry)"
      @contextmenu="handleContextMenu"
    >
      <!-- Folder chevron or spacer -->
      <Icon
        v-if="entry.isDirectory"
        :name="state.expandedFolders.has(entry.path) ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'"
        class="size-3 text-app-muted shrink-0"
      />
      <div v-else class="w-3" />

      <!-- File/folder icon -->
      <Icon
        :name="getFileIcon(entry)"
        :class="['size-4 shrink-0', getFileIconColor(entry)]"
      />

      <!-- Rename input or name display -->
      <input
        v-if="isRenaming"
        ref="renameInput"
        v-model="renameValue"
        class="text-xs bg-white/10 border border-app-accent/50 rounded px-1 py-0.5 outline-none flex-1 min-w-0 text-app"
        @keydown.enter="submitRename"
        @keydown.escape="cancelRename"
        @blur="submitRename"
        @click.stop
      >
      <span v-else class="text-xs truncate">{{ entry.name }}</span>
    </div>

    <!-- Inline create new file/folder (for folders) -->
    <div
      v-if="isCreating && entry.isDirectory"
      class="flex items-center gap-1.5 px-2 py-1"
      :style="{ paddingLeft: `${(depth + 1) * 12 + 8}px` }"
    >
      <div class="w-3" />
      <Icon
        :name="isCreating === 'folder' ? 'i-lucide-folder-plus' : 'i-lucide-file-plus'"
        class="size-4 text-blue-400 shrink-0"
      />
      <input
        ref="createInput"
        v-model="createValue"
        :placeholder="isCreating === 'folder' ? 'Folder name...' : 'File name...'"
        class="text-xs bg-white/10 border border-app-accent/50 rounded px-1 py-0.5 outline-none flex-1 min-w-0 text-app placeholder-app-muted/50"
        @keydown.enter="submitCreate"
        @keydown.escape="cancelCreate"
        @blur="submitCreate"
      >
    </div>

    <!-- Children (if expanded folder) -->
    <template v-if="entry.isDirectory && state.expandedFolders.has(entry.path) && entry.children">
      <FileTreeItem
        v-for="child in entry.children"
        :key="child.path"
        :entry="child"
        :depth="depth + 1"
      />
    </template>

    <!-- Delete Confirmation Modal -->
    <Teleport to="body">
      <ConfirmationModal
        v-model="showDeleteConfirm"
        :title="entry.isDirectory ? 'Delete Folder' : 'Delete File'"
        :message="entry.isDirectory
          ? `Delete folder '${entry.name}' and all its contents?`
          : `Delete file '${entry.name}'?`"
        :details="entry.path"
        confirm-text="Delete"
        confirm-color="error"
        :loading="isDeleting"
        @confirm="confirmDelete"
      />
    </Teleport>
  </div>
</template>
