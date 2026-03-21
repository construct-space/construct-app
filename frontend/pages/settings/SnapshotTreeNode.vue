<script setup lang="ts">
import { ChevronRight, ChevronDown } from 'lucide-vue-next'

interface SnapshotNode {
  id: string
  tag: string
  role?: string
  name?: string
  text?: string
  value?: string
  attributes?: Record<string, string>
  children?: string[]
}

const props = defineProps<{
  node: SnapshotNode
  depth: number
  expandedNodes: Set<string>
  getNodeById: (id: string) => SnapshotNode | undefined
  nodeLabel: (node: SnapshotNode) => string
  toggleNode: (nodeId: string) => void
}>()

const hasChildren = computed(() => props.node.children && props.node.children.length > 0)
const isExpanded = computed(() => props.expandedNodes.has(props.node.id))
const childNodes = computed(() => {
  if (!props.node.children) return []
  return props.node.children.map(id => props.getNodeById(id)).filter(Boolean) as SnapshotNode[]
})

const isInteractive = computed(() => {
  const interactiveTags = ['a', 'button', 'input', 'select', 'textarea']
  return interactiveTags.includes(props.node.tag) || props.node.role === 'button' || props.node.role === 'link'
})
</script>

<template>
  <div :style="{ paddingLeft: `${depth * 12}px` }">
    <div
      class="flex items-start gap-1 py-0.5 rounded hover:bg-[color-mix(in_srgb,var(--app-muted)_8%,transparent)] cursor-default group"
      @click="hasChildren ? toggleNode(node.id) : undefined"
    >
      <!-- Expand/collapse icon -->
      <span v-if="hasChildren" class="shrink-0 mt-px cursor-pointer text-app-muted">
        <ChevronDown v-if="isExpanded" class="size-3" />
        <ChevronRight v-else class="size-3" />
      </span>
      <span v-else class="shrink-0 w-3" />

      <!-- Node ID -->
      <span class="text-[10px] font-mono text-app-muted shrink-0 w-7 text-right mr-1">{{ node.id }}</span>

      <!-- Tag -->
      <span
        :class="[
          'text-[11px] font-mono shrink-0',
          isInteractive ? 'text-app-accent font-semibold' : 'text-app-muted'
        ]"
      >{{ `<${node.tag}>` }}</span>

      <!-- Role badge -->
      <span v-if="node.role" class="text-[9px] px-1 rounded bg-[color-mix(in_srgb,var(--app-accent)_12%,transparent)] text-app-accent shrink-0">
        {{ node.role }}
      </span>

      <!-- Text content -->
      <span v-if="node.text" class="text-[11px] text-app truncate">
        "{{ node.text.length > 60 ? node.text.slice(0, 60) + '...' : node.text }}"
      </span>

      <!-- Value -->
      <span v-if="node.value" class="text-[11px] text-green-400 truncate">
        ={{ node.value.length > 40 ? node.value.slice(0, 40) + '...' : node.value }}
      </span>

      <!-- Attributes (on hover) -->
      <span v-if="node.attributes" class="text-[10px] text-app-muted opacity-0 group-hover:opacity-100 truncate">
        {{ Object.entries(node.attributes).map(([k, v]) => `${k}="${v}"`).join(' ') }}
      </span>
    </div>

    <!-- Children -->
    <template v-if="isExpanded && hasChildren">
      <SnapshotTreeNode
        v-for="child in childNodes"
        :key="child.id"
        :node="child"
        :depth="depth + 1"
        :expanded-nodes="expandedNodes"
        :get-node-by-id="getNodeById"
        :node-label="nodeLabel"
        :toggle-node="toggleNode"
      />
    </template>
  </div>
</template>
