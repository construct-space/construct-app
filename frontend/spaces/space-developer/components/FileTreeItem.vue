<script setup lang="ts">
import { ChevronRight, ChevronDown, Folder, File as FileIcon } from 'lucide-vue-next'

interface Node {
  name: string
  path: string
  isDir: boolean
  expanded?: boolean
  loaded?: boolean
  children?: Node[]
}

defineProps<{ node: Node; depth: number }>()
const emit = defineEmits<{ (e: 'toggle', node: Node): void }>()

function onToggle(node: Node) {
  emit('toggle', node)
}
</script>

<template>
  <li>
    <div
      class="flex items-center gap-1.5 py-0.5 text-xs rounded cursor-pointer truncate hover:bg-[color:var(--app-border)]/40"
      :style="{ paddingLeft: `${8 + depth * 12}px`, color: 'var(--app-foreground)' }"
      @click="onToggle(node)"
    >
      <ChevronDown
        v-if="node.isDir && node.expanded"
        :size="12"
        style="opacity: 0.5; flex-shrink: 0"
      />
      <ChevronRight
        v-else-if="node.isDir"
        :size="12"
        style="opacity: 0.5; flex-shrink: 0"
      />
      <span v-else style="width: 12px; flex-shrink: 0" />
      <Folder
        v-if="node.isDir"
        :size="13"
        style="flex-shrink: 0; color: var(--app-muted)"
      />
      <FileIcon
        v-else
        :size="13"
        style="flex-shrink: 0; color: var(--app-muted)"
      />
      <span class="truncate">{{ node.name }}</span>
    </div>
    <ul v-if="node.isDir && node.expanded && node.children">
      <FileTreeItem
        v-for="child in node.children"
        :key="child.path"
        :node="child"
        :depth="depth + 1"
        @toggle="onToggle"
      />
    </ul>
  </li>
</template>
