<script setup lang="ts">
/**
 * Table - Data table with sorting, selection, and custom slots
 * Supports sticky header, striped rows, loading skeleton, and empty state
 */

export interface TableColumn {
  key: string
  label: string
  sortable?: boolean
  width?: string
  align?: 'left' | 'center' | 'right'
}

const props = withDefaults(defineProps<{
  columns: TableColumn[]
  rows: Record<string, any>[]
  loading?: boolean
  selectable?: boolean | 'single' | 'multi'
  striped?: boolean
  size?: 'compact' | 'comfortable'
  stickyHeader?: boolean
  rowKey?: string
  skeletonRows?: number
}>(), {
  loading: false,
  selectable: false,
  striped: false,
  size: 'comfortable',
  stickyHeader: true,
  rowKey: 'id',
  skeletonRows: 5,
})

const emit = defineEmits<{
  select: [selected: Record<string, any>[]]
  sort: [payload: { key: string; direction: 'asc' | 'desc' }]
  'row-click': [row: Record<string, any>, index: number]
}>()

const slots = defineSlots<{
  [key: `cell-${string}`]: (props: { row: Record<string, any>; value: any; index: number }) => any
  [key: `header-${string}`]: (props: { column: TableColumn }) => any
  empty: () => any
}>()

const sortKey = ref<string | null>(null)
const sortDirection = ref<'asc' | 'desc'>('asc')
const selectedKeys = ref<Set<string | number>>(new Set())

const selectionMode = computed(() => {
  if (props.selectable === true || props.selectable === 'multi') return 'multi'
  if (props.selectable === 'single') return 'single'
  return null
})

const cellPadding = computed(() => {
  return props.size === 'compact' ? 'px-3 py-1.5' : 'px-4 py-2.5'
})

const headerPadding = computed(() => {
  return props.size === 'compact' ? 'px-3 py-1.5' : 'px-4 py-2'
})

const textSize = computed(() => {
  return props.size === 'compact' ? 'text-xs' : 'text-sm'
})

function getRowKey(row: Record<string, any>, index: number): string | number {
  return row[props.rowKey] ?? index
}

function alignClass(align?: string) {
  if (align === 'center') return 'text-center'
  if (align === 'right') return 'text-right'
  return 'text-left'
}

function handleSort(column: TableColumn) {
  if (!column.sortable) return
  if (sortKey.value === column.key) {
    sortDirection.value = sortDirection.value === 'asc' ? 'desc' : 'asc'
  } else {
    sortKey.value = column.key
    sortDirection.value = 'asc'
  }
  emit('sort', { key: column.key, direction: sortDirection.value })
}

function handleRowClick(row: Record<string, any>, index: number) {
  emit('row-click', row, index)
}

function toggleRow(row: Record<string, any>, index: number) {
  const key = getRowKey(row, index)
  if (selectionMode.value === 'single') {
    if (selectedKeys.value.has(key)) {
      selectedKeys.value.clear()
    } else {
      selectedKeys.value.clear()
      selectedKeys.value.add(key)
    }
  } else if (selectionMode.value === 'multi') {
    if (selectedKeys.value.has(key)) {
      selectedKeys.value.delete(key)
    } else {
      selectedKeys.value.add(key)
    }
  }
  emitSelection()
}

function toggleAll() {
  if (allSelected.value) {
    selectedKeys.value.clear()
  } else {
    props.rows.forEach((row, i) => {
      selectedKeys.value.add(getRowKey(row, i))
    })
  }
  emitSelection()
}

function emitSelection() {
  const selected = props.rows.filter((row, i) => selectedKeys.value.has(getRowKey(row, i)))
  emit('select', selected)
}

const allSelected = computed(() => {
  return props.rows.length > 0 && props.rows.every((row, i) => selectedKeys.value.has(getRowKey(row, i)))
})

const someSelected = computed(() => {
  return !allSelected.value && props.rows.some((row, i) => selectedKeys.value.has(getRowKey(row, i)))
})

function isRowSelected(row: Record<string, any>, index: number) {
  return selectedKeys.value.has(getRowKey(row, index))
}
</script>

<template>
  <div class="w-full overflow-auto rounded-lg border border-[var(--app-border)]">
    <table class="w-full border-collapse" :class="textSize">
      <!-- Header -->
      <thead>
        <tr
          :class="[
            'bg-[color-mix(in_srgb,var(--app-background)_95%,var(--app-foreground))]',
            'border-b border-[var(--app-border)]',
          ]"
        >
          <!-- Selection checkbox column -->
          <th
            v-if="selectionMode"
            :class="[
              headerPadding,
              'w-10 text-center',
              stickyHeader ? 'sticky top-0 z-10 bg-[color-mix(in_srgb,var(--app-background)_95%,var(--app-foreground))]' : '',
            ]"
          >
            <input
              v-if="selectionMode === 'multi'"
              type="checkbox"
              :checked="allSelected"
              :indeterminate="someSelected"
              class="size-3.5 rounded border-[var(--app-border)] accent-[var(--app-accent)] cursor-pointer"
              @change="toggleAll"
            />
          </th>

          <th
            v-for="col in columns"
            :key="col.key"
            :style="col.width ? { width: col.width } : {}"
            :class="[
              headerPadding,
              alignClass(col.align),
              'font-medium text-[var(--app-muted)] whitespace-nowrap select-none',
              col.sortable ? 'cursor-pointer hover:text-[var(--app-foreground)] transition-colors' : '',
              stickyHeader ? 'sticky top-0 z-10 bg-[color-mix(in_srgb,var(--app-background)_95%,var(--app-foreground))]' : '',
            ]"
            @click="handleSort(col)"
          >
            <slot :name="`header-${col.key}`" :column="col">
              <span class="inline-flex items-center gap-1">
                {{ col.label }}
                <svg
                  v-if="col.sortable"
                  class="size-3.5 shrink-0 transition-transform"
                  :class="[
                    sortKey === col.key ? 'opacity-100 text-[var(--app-foreground)]' : 'opacity-30',
                    sortKey === col.key && sortDirection === 'desc' ? 'rotate-180' : '',
                  ]"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <path d="M12 5v14M5 12l7-7 7 7" />
                </svg>
              </span>
            </slot>
          </th>
        </tr>
      </thead>

      <!-- Loading skeleton -->
      <tbody v-if="loading">
        <tr
          v-for="r in skeletonRows"
          :key="r"
          class="border-b border-[var(--app-border)] last:border-b-0"
        >
          <td v-if="selectionMode" :class="cellPadding" class="text-center">
            <div class="h-3.5 w-3.5 mx-auto rounded bg-[var(--app-muted)]/15 animate-pulse" />
          </td>
          <td
            v-for="col in columns"
            :key="col.key"
            :class="[cellPadding, alignClass(col.align)]"
          >
            <div
              class="h-4 rounded bg-[var(--app-muted)]/15 animate-pulse"
              :style="{ width: `${40 + Math.random() * 40}%` }"
            />
          </td>
        </tr>
      </tbody>

      <!-- Empty state -->
      <tbody v-else-if="rows.length === 0">
        <tr>
          <td
            :colspan="columns.length + (selectionMode ? 1 : 0)"
            class="px-4 py-10 text-center text-[var(--app-muted)]"
          >
            <slot name="empty">
              <div class="flex flex-col items-center gap-2">
                <svg class="size-8 opacity-30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <polyline points="14 2 14 8 20 8" />
                  <line x1="9" y1="15" x2="15" y2="15" />
                </svg>
                <span class="text-sm">No data available</span>
              </div>
            </slot>
          </td>
        </tr>
      </tbody>

      <!-- Data rows -->
      <tbody v-else>
        <tr
          v-for="(row, index) in rows"
          :key="getRowKey(row, index)"
          :class="[
            'border-b border-[var(--app-border)] last:border-b-0 transition-colors',
            'hover:bg-[color-mix(in_srgb,var(--app-accent)_5%,transparent)]',
            striped && index % 2 === 1 ? 'bg-[color-mix(in_srgb,var(--app-foreground)_2%,transparent)]' : '',
            isRowSelected(row, index) ? 'bg-[color-mix(in_srgb,var(--app-accent)_10%,transparent)]!' : '',
            selectionMode ? 'cursor-pointer' : '',
          ]"
          @click="handleRowClick(row, index)"
        >
          <!-- Selection checkbox -->
          <td
            v-if="selectionMode"
            :class="[cellPadding, 'w-10 text-center']"
            @click.stop="toggleRow(row, index)"
          >
            <input
              type="checkbox"
              :checked="isRowSelected(row, index)"
              class="size-3.5 rounded border-[var(--app-border)] accent-[var(--app-accent)] cursor-pointer"
              @click.stop
              @change="toggleRow(row, index)"
            />
          </td>

          <!-- Data cells -->
          <td
            v-for="col in columns"
            :key="col.key"
            :class="[cellPadding, alignClass(col.align), 'text-[var(--app-foreground)]']"
          >
            <slot :name="`cell-${col.key}`" :row="row" :value="row[col.key]" :index="index">
              {{ row[col.key] }}
            </slot>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
