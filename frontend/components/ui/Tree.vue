<script setup lang="ts">
/**
 * Tree — Construct UI
 * File-tree style component with expand/collapse, keyboard navigation,
 * single/multi selection, indent guides, and optional drag-and-drop.
 */
import { Icon } from '@iconify/vue'

export interface TreeNode {
  id: string
  label: string
  icon?: string
  children?: TreeNode[]
  expanded?: boolean
  selected?: boolean
  data?: any
}

const props = withDefaults(defineProps<{
  items?: TreeNode[]
  modelValue?: string | string[] | null
  multiple?: boolean
  draggable?: boolean
  indentPx?: number
}>(), {
  items: () => [],
  modelValue: null,
  multiple: false,
  draggable: false,
  indentPx: 16,
})

const emit = defineEmits<{
  'update:modelValue': [value: string | string[] | null]
  'select': [node: TreeNode]
  'expand': [node: TreeNode]
  'collapse': [node: TreeNode]
  'drop': [payload: { dragged: TreeNode; target: TreeNode; position: 'before' | 'inside' | 'after' }]
}>()

/* ── Internal expanded state ── */
const expandedIds = ref<Set<string>>(new Set())

// Initialise expanded state from items
function initExpanded(nodes: TreeNode[]) {
  for (const node of nodes) {
    if (node.expanded) expandedIds.value.add(node.id)
    if (node.children?.length) initExpanded(node.children)
  }
}
watch(() => props.items, (items) => initExpanded(items), { immediate: true, deep: true })

function isExpanded(node: TreeNode): boolean {
  return expandedIds.value.has(node.id)
}

function toggleExpand(node: TreeNode) {
  if (!node.children?.length) return
  const set = new Set(expandedIds.value)
  if (set.has(node.id)) {
    set.delete(node.id)
    expandedIds.value = set
    emit('collapse', node)
  } else {
    set.add(node.id)
    expandedIds.value = set
    emit('expand', node)
  }
}

/* ── Selection ── */
const selectedIds = computed<Set<string>>(() => {
  const v = props.modelValue
  if (v == null) return new Set()
  if (Array.isArray(v)) return new Set(v)
  return new Set([v])
})

function isSelected(node: TreeNode): boolean {
  return selectedIds.value.has(node.id)
}

function selectNode(node: TreeNode, event?: MouseEvent | KeyboardEvent) {
  if (props.multiple && event && (event.metaKey || event.ctrlKey)) {
    const ids = new Set(selectedIds.value)
    if (ids.has(node.id)) {
      ids.delete(node.id)
    } else {
      ids.add(node.id)
    }
    emit('update:modelValue', [...ids])
  } else if (props.multiple) {
    emit('update:modelValue', [node.id])
  } else {
    emit('update:modelValue', node.id)
  }
  emit('select', node)
}

/* ── Flatten visible nodes for keyboard navigation ── */
function flattenVisible(nodes: TreeNode[]): TreeNode[] {
  const result: TreeNode[] = []
  for (const node of nodes) {
    result.push(node)
    if (node.children?.length && isExpanded(node)) {
      result.push(...flattenVisible(node.children))
    }
  }
  return result
}

/* ── Focused node (for keyboard nav) ── */
const focusedId = ref<string | null>(null)

const treeRoot = ref<HTMLElement | null>(null)

function handleKeydown(e: KeyboardEvent) {
  const visible = flattenVisible(props.items)
  if (!visible.length) return

  const idx = visible.findIndex(n => n.id === focusedId.value)
  let current = idx >= 0 ? idx : 0

  switch (e.key) {
    case 'ArrowDown': {
      e.preventDefault()
      current = Math.min(current + 1, visible.length - 1)
      focusedId.value = visible[current].id
      scrollToNode(visible[current].id)
      break
    }
    case 'ArrowUp': {
      e.preventDefault()
      current = Math.max(current - 1, 0)
      focusedId.value = visible[current].id
      scrollToNode(visible[current].id)
      break
    }
    case 'ArrowRight': {
      e.preventDefault()
      const node = visible[current]
      if (node.children?.length && !isExpanded(node)) {
        toggleExpand(node)
      } else if (node.children?.length && isExpanded(node)) {
        // Move to first child
        const nextIdx = current + 1
        if (nextIdx < visible.length) {
          focusedId.value = visible[nextIdx].id
        }
      }
      break
    }
    case 'ArrowLeft': {
      e.preventDefault()
      const node = visible[current]
      if (node.children?.length && isExpanded(node)) {
        toggleExpand(node)
      } else {
        // Move to parent
        const parentNode = findParent(props.items, node.id)
        if (parentNode) {
          focusedId.value = parentNode.id
          scrollToNode(parentNode.id)
        }
      }
      break
    }
    case 'Enter': {
      e.preventDefault()
      const node = visible[current]
      selectNode(node, e)
      break
    }
    case ' ': {
      e.preventDefault()
      const node = visible[current]
      if (node.children?.length) {
        toggleExpand(node)
      } else {
        selectNode(node, e)
      }
      break
    }
  }
}

function findParent(nodes: TreeNode[], childId: string, parent?: TreeNode): TreeNode | null {
  for (const node of nodes) {
    if (node.children) {
      for (const child of node.children) {
        if (child.id === childId) return node
      }
      const found = findParent(node.children, childId, node)
      if (found) return found
    }
  }
  return null
}

function scrollToNode(id: string) {
  nextTick(() => {
    const el = treeRoot.value?.querySelector(`[data-node-id="${id}"]`) as HTMLElement | null
    el?.scrollIntoView({ block: 'nearest' })
  })
}

function getDepth(nodes: TreeNode[], id: string, depth = 0): number {
  for (const node of nodes) {
    if (node.id === id) return depth
    if (node.children) {
      const d = getDepth(node.children, id, depth + 1)
      if (d >= 0) return d
    }
  }
  return -1
}

/* ── Icon helper ── */
function toIconify(name: string): string {
  if (name.startsWith('i-')) {
    const stripped = name.slice(2)
    const idx = stripped.indexOf('-')
    if (idx > 0) return stripped.slice(0, idx) + ':' + stripped.slice(idx + 1)
    return stripped
  }
  return name
}

/* ── Drag and drop ── */
const draggedNode = ref<TreeNode | null>(null)
const dropTargetId = ref<string | null>(null)
const dropPosition = ref<'before' | 'inside' | 'after'>('inside')

function onDragStart(e: DragEvent, node: TreeNode) {
  if (!props.draggable) return
  draggedNode.value = node
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', node.id)
  }
}

function onDragOver(e: DragEvent, node: TreeNode) {
  if (!props.draggable || !draggedNode.value) return
  if (draggedNode.value.id === node.id) return
  e.preventDefault()
  dropTargetId.value = node.id

  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
  const y = e.clientY - rect.top
  const h = rect.height
  if (y < h * 0.25) {
    dropPosition.value = 'before'
  } else if (y > h * 0.75) {
    dropPosition.value = 'after'
  } else {
    dropPosition.value = 'inside'
  }
}

function onDragLeave(_e: DragEvent, node: TreeNode) {
  if (dropTargetId.value === node.id) {
    dropTargetId.value = null
  }
}

function onDrop(e: DragEvent, node: TreeNode) {
  if (!props.draggable || !draggedNode.value) return
  e.preventDefault()
  emit('drop', {
    dragged: draggedNode.value,
    target: node,
    position: dropPosition.value,
  })
  draggedNode.value = null
  dropTargetId.value = null
}

function onDragEnd() {
  draggedNode.value = null
  dropTargetId.value = null
}
</script>

<template>
  <div
    ref="treeRoot"
    role="tree"
    tabindex="0"
    class="tree-root text-sm text-[var(--app-foreground)] outline-none select-none overflow-auto"
    @keydown="handleKeydown"
    @focus="() => { if (!focusedId && items.length) focusedId = items[0].id }"
  >
    <template v-for="node in items" :key="node.id">
      <TreeNodeRow
        :node="node"
        :depth="0"
        :indent-px="indentPx"
        :items="items"
        :is-expanded="isExpanded"
        :is-selected="isSelected"
        :focused-id="focusedId"
        :draggable-enabled="draggable"
        :drop-target-id="dropTargetId"
        :drop-position="dropPosition"
        @toggle="toggleExpand"
        @select="(n: TreeNode, e?: MouseEvent) => selectNode(n, e)"
        @drag-start="onDragStart"
        @drag-over="onDragOver"
        @drag-leave="onDragLeave"
        @drop="onDrop"
        @drag-end="onDragEnd"
      >
        <template #node="slotProps">
          <slot name="node" v-bind="slotProps" />
        </template>
      </TreeNodeRow>
    </template>
  </div>
</template>

<!-- Recursive child component defined in the same SFC via a second script block -->
<script lang="ts">
import { defineComponent, h, Transition, ref, nextTick, computed, watch, type PropType } from 'vue'
import { Icon as IconComponent } from '@iconify/vue'

/**
 * Recursive TreeNodeRow — renders a single tree node with its children.
 * Defined as a named component so it can call itself recursively.
 */
const TreeNodeRow = defineComponent({
  name: 'TreeNodeRow',
  props: {
    node: { type: Object as PropType<TreeNode>, required: true },
    depth: { type: Number, required: true },
    indentPx: { type: Number, default: 16 },
    items: { type: Array as PropType<TreeNode[]>, required: true },
    isExpanded: { type: Function as PropType<(n: TreeNode) => boolean>, required: true },
    isSelected: { type: Function as PropType<(n: TreeNode) => boolean>, required: true },
    focusedId: { type: String as PropType<string | null>, default: null },
    draggableEnabled: { type: Boolean, default: false },
    dropTargetId: { type: String as PropType<string | null>, default: null },
    dropPosition: { type: String as PropType<'before' | 'inside' | 'after'>, default: 'inside' },
  },
  emits: ['toggle', 'select', 'drag-start', 'drag-over', 'drag-leave', 'drop', 'drag-end'],
  setup(props, { emit, slots }) {
    function toIconify(name: string): string {
      if (name.startsWith('i-')) {
        const stripped = name.slice(2)
        const idx = stripped.indexOf('-')
        if (idx > 0) return stripped.slice(0, idx) + ':' + stripped.slice(idx + 1)
        return stripped
      }
      return name
    }

    return () => {
      const { node, depth, indentPx, isExpanded, isSelected, focusedId, draggableEnabled, dropTargetId, dropPosition } = props
      const hasChildren = !!(node.children?.length)
      const expanded = hasChildren && isExpanded(node)
      const selected = isSelected(node)
      const focused = focusedId === node.id
      const isDropTarget = dropTargetId === node.id

      const paddingLeft = `${depth * indentPx + 4}px`

      // Indent guides
      const guides: any[] = []
      for (let i = 0; i < depth; i++) {
        guides.push(
          h('span', {
            class: 'absolute top-0 bottom-0 w-px bg-[var(--app-border)] opacity-40',
            style: { left: `${i * indentPx + indentPx / 2 + 4}px` },
          })
        )
      }

      // Chevron
      const chevron = hasChildren
        ? h('span', {
            class: [
              'flex items-center justify-center w-4 h-4 shrink-0 transition-transform duration-150',
              expanded ? 'rotate-90' : '',
            ],
            onClick: (e: MouseEvent) => {
              e.stopPropagation()
              emit('toggle', node)
            },
          }, [
            h('svg', {
              xmlns: 'http://www.w3.org/2000/svg',
              width: '12',
              height: '12',
              viewBox: '0 0 24 24',
              fill: 'none',
              stroke: 'currentColor',
              'stroke-width': '2',
              'stroke-linecap': 'round',
              'stroke-linejoin': 'round',
              class: 'text-[var(--app-muted)]',
            }, [
              h('polyline', { points: '9 6 15 12 9 18' }),
            ]),
          ])
        : h('span', { class: 'w-4 h-4 shrink-0' })

      // Icon
      const icon = node.icon
        ? h(IconComponent, {
            icon: toIconify(node.icon),
            class: 'size-4 shrink-0 text-[var(--app-muted)]',
          })
        : null

      // Label / slot
      const nodeSlot = slots.node
        ? slots.node({ node, depth, expanded, selected })
        : [
            icon,
            h('span', { class: 'truncate' }, node.label),
          ]

      // Drop indicator classes
      let dropBorderClass = ''
      if (isDropTarget && draggableEnabled) {
        if (dropPosition === 'before') {
          dropBorderClass = 'ring-t-2 ring-[var(--app-accent)]'
        } else if (dropPosition === 'after') {
          dropBorderClass = 'ring-b-2 ring-[var(--app-accent)]'
        } else {
          dropBorderClass = 'ring-1 ring-[var(--app-accent)] ring-inset'
        }
      }

      // Row
      const row = h('div', {
        'data-node-id': node.id,
        class: [
          'relative flex items-center gap-1.5 py-[3px] pr-2 cursor-pointer rounded-sm transition-colors duration-75',
          selected
            ? 'bg-[var(--app-accent)]/15 text-[var(--app-foreground)]'
            : 'hover:bg-[var(--app-foreground)]/5 text-[var(--app-foreground)]',
          focused ? 'outline outline-1 outline-[var(--app-accent)]/50 -outline-offset-1' : '',
          dropBorderClass,
        ],
        style: { paddingLeft },
        draggable: draggableEnabled ? 'true' : undefined,
        onClick: (e: MouseEvent) => emit('select', node, e),
        onDragstart: (e: DragEvent) => emit('drag-start', e, node),
        onDragover: (e: DragEvent) => emit('drag-over', e, node),
        onDragleave: (e: DragEvent) => emit('drag-leave', e, node),
        onDrop: (e: DragEvent) => emit('drop', e, node),
        onDragend: () => emit('drag-end'),
      }, [
        ...guides,
        chevron,
        ...((Array.isArray(nodeSlot) ? nodeSlot : [nodeSlot]).filter(Boolean)),
      ])

      // Children
      const children = hasChildren
        ? h(Transition, {
            name: 'tree-expand',
            onBeforeEnter(el: Element) {
              const htmlEl = el as HTMLElement
              htmlEl.style.maxHeight = '0'
              htmlEl.style.opacity = '0'
            },
            onEnter(el: Element, done: () => void) {
              const htmlEl = el as HTMLElement
              htmlEl.style.transition = 'max-height 150ms ease-out, opacity 150ms ease-out'
              htmlEl.style.maxHeight = htmlEl.scrollHeight + 'px'
              htmlEl.style.opacity = '1'
              htmlEl.addEventListener('transitionend', done, { once: true })
            },
            onAfterEnter(el: Element) {
              const htmlEl = el as HTMLElement
              htmlEl.style.maxHeight = ''
              htmlEl.style.transition = ''
            },
            onBeforeLeave(el: Element) {
              const htmlEl = el as HTMLElement
              htmlEl.style.maxHeight = htmlEl.scrollHeight + 'px'
              htmlEl.style.opacity = '1'
            },
            onLeave(el: Element, done: () => void) {
              const htmlEl = el as HTMLElement
              htmlEl.style.transition = 'max-height 150ms ease-in, opacity 150ms ease-in'
              htmlEl.style.maxHeight = '0'
              htmlEl.style.opacity = '0'
              htmlEl.addEventListener('transitionend', done, { once: true })
            },
            onAfterLeave(el: Element) {
              const htmlEl = el as HTMLElement
              htmlEl.style.maxHeight = ''
              htmlEl.style.transition = ''
            },
          }, {
            default: () =>
              expanded
                ? h('div', { class: 'overflow-hidden' },
                    node.children!.map(child =>
                      h(TreeNodeRow, {
                        key: child.id,
                        node: child,
                        depth: depth + 1,
                        indentPx,
                        items: props.items,
                        isExpanded,
                        isSelected,
                        focusedId,
                        draggableEnabled,
                        dropTargetId,
                        dropPosition,
                        onToggle: (n: TreeNode) => emit('toggle', n),
                        onSelect: (n: TreeNode, e?: MouseEvent) => emit('select', n, e),
                        'onDrag-start': (e: DragEvent, n: TreeNode) => emit('drag-start', e, n),
                        'onDrag-over': (e: DragEvent, n: TreeNode) => emit('drag-over', e, n),
                        'onDrag-leave': (e: DragEvent, n: TreeNode) => emit('drag-leave', e, n),
                        onDrop: (e: DragEvent, n: TreeNode) => emit('drop', e, n),
                        'onDrag-end': () => emit('drag-end'),
                      }, {
                        node: slots.node,
                      })
                    )
                  )
                : null,
          })
        : null

      return h('div', { key: node.id }, [row, children])
    }
  },
})

export default {
  components: { TreeNodeRow },
}
</script>

<style scoped>
.tree-root:focus-visible {
  outline: none;
}
</style>
