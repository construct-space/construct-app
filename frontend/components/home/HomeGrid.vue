<script setup lang="ts">
/**
 * HomeGrid — 12×8 space widget grid.
 * Edit mode: drag to reorder/move, drag-resize (live), remove, add via empty cell.
 *
 * Drag behavior:
 *   - Drag widget over another widget → swap positions
 *   - Drag widget over empty area → move widget to that grid cell
 */
import { ref, computed } from 'vue'
import type { WidgetPlacement } from '@/composables/useWidgetRegistry'
import type { Component } from 'vue'
import { Pencil, Plus } from 'lucide-vue-next'

const props = defineProps<{
  items: WidgetPlacement[]
  gridCols: number
  /** Default visible rows at rest — keeps the home page from scrolling. */
  gridRows: number
  /** Max rows users can expand into while editing. Falls back to gridRows
   *  when not provided (old callers keep their behavior). */
  gridMaxRows?: number
  getComponent: (spaceId: string, widgetId: string, sizeKey: string) => Promise<Component | null>
  availableSizes: (spaceId: string, widgetId: string) => string[]
}>()

const emit = defineEmits<{
  remove: [instanceId: string]
  resize: [instanceId: string, sizeKey: string]
  swap: [idA: string, idB: string]
  move: [instanceId: string, x: number, y: number]
  moveResize: [instanceId: string, x: number, y: number, sizeKey: string]
  addWidget: []
}>()

const editing = ref(false)
const gridEl = ref<HTMLElement | null>(null)

// Rendered row count. Always extends to cover every placed widget.
// In edit mode we add EDIT_HEADROOM empty rows below the last widget so
// the user always has a clearly-visible drop zone beyond what's placed.
// gridMaxRows acts as a sanity ceiling so findPosition() + grid rendering
// can't run away.
const EDIT_HEADROOM = 2
const displayRows = computed(() => {
  const max = props.gridMaxRows ?? 64
  let bottom = props.gridRows
  for (const item of props.items) {
    const end = item.y + item.h
    if (end > bottom) bottom = end
  }
  if (editing.value) {
    return Math.min(Math.max(bottom + EDIT_HEADROOM, props.gridRows), max)
  }
  return Math.min(Math.max(bottom, props.gridRows), max)
})

const dragId = ref<string | null>(null)
const dropTargetId = ref<string | null>(null)          // widget swap target
const dropCell = ref<{ x: number; y: number; sizeKey?: string } | null>(null)  // empty cell move target
const resizingId = ref<string | null>(null)
const resizePreviewW = ref(0)
const resizePreviewH = ref(0)

function parseSize(s: string) {
  const [w, h] = s.split('x').map(Number)
  return { w: w || 1, h: h || 1 }
}

function getGridStyle(item: WidgetPlacement) {
  const w = (resizingId.value === item.instanceId && resizePreviewW.value) ? resizePreviewW.value : item.w
  const h = (resizingId.value === item.instanceId && resizePreviewH.value) ? resizePreviewH.value : item.h
  return {
    gridColumn: `${item.x + 1} / span ${w}`,
    gridRow: `${item.y + 1} / span ${h}`,
  }
}

function getCellSize() {
  const grid = gridEl.value
  if (!grid) return { cellW: 100, cellH: 80 }
  const rect = grid.getBoundingClientRect()
  return { cellW: rect.width / props.gridCols, cellH: rect.height / displayRows.value }
}

// Convert screen coords to grid cell
function screenToCell(clientX: number, clientY: number): { col: number; row: number } | null {
  const grid = gridEl.value
  if (!grid) return null
  const rect = grid.getBoundingClientRect()
  const col = Math.floor((clientX - rect.left) / (rect.width / props.gridCols))
  const row = Math.floor((clientY - rect.top) / (rect.height / displayRows.value))
  if (col < 0 || col >= props.gridCols || row < 0 || row >= displayRows.value) return null
  return { col, row }
}

// Build occupancy grid (which cells are taken)
function buildOccupancy(excludeId?: string): boolean[][] {
  const grid = Array.from({ length: displayRows.value }, () => Array(props.gridCols).fill(false))
  for (const item of props.items) {
    if (excludeId && item.instanceId === excludeId) continue
    for (let r = item.y; r < item.y + item.h; r++) {
      for (let c = item.x; c < item.x + item.w; c++) {
        if (r < displayRows.value && c < props.gridCols) grid[r][c] = true
      }
    }
  }
  return grid
}

// Check if a widget fits at a position (excluding itself)
function fitsAt(x: number, y: number, w: number, h: number, excludeId: string): boolean {
  if (x < 0 || y < 0 || x + w > props.gridCols || y + h > displayRows.value) return false
  const occ = buildOccupancy(excludeId)
  for (let r = y; r < y + h; r++) {
    for (let c = x; c < x + w; c++) {
      if (occ[r][c]) return false
    }
  }
  return true
}

// Find the best fitting size for a widget at a position
// Tries current size first, then largest-to-smallest available sizes
function bestFitSize(item: WidgetPlacement, x: number, y: number): string | null {
  // Try current size first
  if (fitsAt(x, y, item.w, item.h, item.instanceId)) return item.sizeKey

  const sizes = props.availableSizes(item.spaceId, item.widgetId)
  if (sizes.length <= 1) return null

  // Sort by area descending (prefer largest that fits)
  const sorted = [...sizes]
    .map(s => { const [w, h] = s.split('x').map(Number); return { key: s, w, h, area: w * h } })
    .sort((a, b) => b.area - a.area)

  for (const s of sorted) {
    if (fitsAt(x, y, s.w, s.h, item.instanceId)) return s.key
  }
  return null
}

// Find which widget is at a cell
function widgetAtCell(col: number, row: number, excludeId?: string): string | null {
  for (const item of props.items) {
    if (excludeId && item.instanceId === excludeId) continue
    if (col >= item.x && col < item.x + item.w && row >= item.y && row < item.y + item.h) {
      return item.instanceId
    }
  }
  return null
}

// ── Drag to reorder / move ──

function onMoveStart(e: MouseEvent, item: WidgetPlacement) {
  if (resizingId.value) return
  e.preventDefault()
  e.stopPropagation()

  dragId.value = item.instanceId
  const startX = e.clientX
  const startY = e.clientY
  let moved = false

  const onMove = (ev: MouseEvent) => {
    if (!moved && Math.abs(ev.clientX - startX) < 5 && Math.abs(ev.clientY - startY) < 5) return
    moved = true

    const cell = screenToCell(ev.clientX, ev.clientY)
    if (!cell) {
      dropTargetId.value = null
      dropCell.value = null
      return
    }

    // Check if hovering over another widget
    const targetWidget = widgetAtCell(cell.col, cell.row, item.instanceId)
    if (targetWidget) {
      dropTargetId.value = targetWidget
      dropCell.value = null
      return
    }

    // Check if dragged widget fits at this cell (auto-downsize if needed)
    dropTargetId.value = null
    const fitSize = bestFitSize(item, cell.col, cell.row)
    if (fitSize) {
      dropCell.value = { x: cell.col, y: cell.row, sizeKey: fitSize }
    } else {
      dropCell.value = null
    }
  }

  const onUp = () => {
    document.removeEventListener('mousemove', onMove, true)
    document.removeEventListener('mouseup', onUp, true)

    if (moved) {
      if (dropTargetId.value) {
        emit('swap', item.instanceId, dropTargetId.value)
      } else if (dropCell.value) {
        if (dropCell.value.sizeKey && dropCell.value.sizeKey !== item.sizeKey) {
          emit('moveResize', item.instanceId, dropCell.value.x, dropCell.value.y, dropCell.value.sizeKey)
        } else {
          emit('move', item.instanceId, dropCell.value.x, dropCell.value.y)
        }
      }
    }
    dragId.value = null
    dropTargetId.value = null
    dropCell.value = null
  }

  document.addEventListener('mousemove', onMove, true)
  document.addEventListener('mouseup', onUp, true)
}

// ── Drag to resize ──

function onResizeStart(e: MouseEvent, item: WidgetPlacement) {
  e.preventDefault()
  e.stopPropagation()

  const sizes = props.availableSizes(item.spaceId, item.widgetId)
  if (sizes.length <= 1) return

  resizingId.value = item.instanceId
  resizePreviewW.value = item.w
  resizePreviewH.value = item.h

  const startX = e.clientX
  const startY = e.clientY
  const startW = item.w
  const startH = item.h
  const { cellW, cellH } = getCellSize()
  const parsedSizes = sizes.map(s => ({ key: s, ...parseSize(s) }))

  const onMove = (ev: MouseEvent) => {
    const targetW = Math.max(1, Math.min(props.gridCols - item.x, Math.round(startW + (ev.clientX - startX) / cellW)))
    const maxRows = props.gridMaxRows ?? props.gridRows
    const targetH = Math.max(1, Math.min(maxRows - item.y, Math.round(startH + (ev.clientY - startY) / cellH)))
    let best = parsedSizes[0]
    let bestDist = Infinity
    for (const s of parsedSizes) {
      const d = Math.abs(s.w - targetW) + Math.abs(s.h - targetH)
      if (d < bestDist) { bestDist = d; best = s }
    }
    resizePreviewW.value = best.w
    resizePreviewH.value = best.h
  }

  const onUp = () => {
    document.removeEventListener('mousemove', onMove, true)
    document.removeEventListener('mouseup', onUp, true)
    const finalSize = `${resizePreviewW.value}x${resizePreviewH.value}`
    if (finalSize !== item.sizeKey) {
      emit('resize', item.instanceId, finalSize)
    }
    resizingId.value = null
    resizePreviewW.value = 0
    resizePreviewH.value = 0
  }

  document.addEventListener('mousemove', onMove, true)
  document.addEventListener('mouseup', onUp, true)
}

// ── Empty cells ──

const emptyCells = computed(() => {
  if (!editing.value) return []
  const occ = buildOccupancy()
  const cells: { x: number; y: number }[] = []
  for (let r = 0; r < displayRows.value; r++) {
    for (let c = 0; c < props.gridCols; c++) {
      if (!occ[r][c]) cells.push({ x: c, y: r })
    }
  }
  return cells
})

// Drop preview: show where the dragged widget would land
const dropPreviewStyle = computed(() => {
  if (!dropCell.value || !dragId.value) return null
  const item = props.items.find(i => i.instanceId === dragId.value)
  if (!item) return null
  // Use the fit size if auto-downsized, otherwise item's current size
  const fitKey = dropCell.value.sizeKey || item.sizeKey
  const { w, h } = parseSize(fitKey)
  return {
    gridColumn: `${dropCell.value.x + 1} / span ${w}`,
    gridRow: `${dropCell.value.y + 1} / span ${h}`,
  }
})
</script>

<template>
  <div>
    <!-- Edit toggle -->
    <div class="flex items-center justify-end mb-2">
      <button
        class="text-xs transition-colors flex items-center gap-1 px-2 py-1 rounded-md"
        :class="editing
          ? 'text-[var(--app-accent)] bg-[var(--app-accent)]/10'
          : 'text-[var(--app-muted)] hover:text-[var(--app-accent)]'"
        data-tour="dashboard-edit"
        @click="editing = !editing"
      >
        <Pencil class="size-3" />
        {{ editing ? 'Done' : 'Edit' }}
      </button>
    </div>

    <!-- Grid -->
    <div
      ref="gridEl"
      class="grid gap-2 transition-all duration-200 rounded-2xl"
      :class="editing ? 'edit-grid p-2 border-2 border-dashed border-[var(--app-accent)]/30' : ''"
      :style="{
        gridTemplateColumns: `repeat(${gridCols}, 1fr)`,
        gridTemplateRows: `repeat(${displayRows}, 80px)`,
      }"
    >
      <!-- Widgets -->
      <div
        v-for="item in items"
        :key="item.instanceId"
        :style="getGridStyle(item)"
        class="relative transition-all duration-150"
        :class="{
          'z-30': resizingId === item.instanceId,
          'opacity-30 scale-95': dragId === item.instanceId,
        }"
      >
        <WidgetChrome
          :placement="item"
          :get-component="getComponent"
          :removable="false"
        />

        <!-- Edit overlay -->
        <div
          v-if="editing"
          class="absolute inset-0 z-20 rounded-xl transition-all select-none"
          :class="{
            'ring-2 ring-[var(--app-accent)] bg-[var(--app-accent)]/10': dropTargetId === item.instanceId,
            'ring-2 ring-[var(--app-accent)]/60': resizingId === item.instanceId,
            'cursor-grab': !dragId && !resizingId,
            'cursor-grabbing': dragId === item.instanceId,
          }"
          @mousedown="onMoveStart($event, item)"
        >
          <!-- Remove button (inside overlay so it's above drag surface) -->
          <button
            class="absolute top-1.5 right-1.5 z-30 size-5 rounded-full bg-[var(--app-background)] border border-[var(--app-border)] flex items-center justify-center hover:bg-red-500/20 hover:border-red-500/40 transition-colors"
            @mousedown.stop
            @click.stop="emit('remove', item.instanceId)"
          >
            <svg class="size-3 text-[var(--app-muted)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </button>

          <!-- Size label while resizing -->
          <span
            v-if="resizingId === item.instanceId"
            class="absolute top-1.5 left-1.5 px-1.5 py-0.5 rounded text-[10px] font-mono bg-[var(--app-accent)] text-white pointer-events-none"
          >
            {{ resizePreviewW }}×{{ resizePreviewH }}
          </span>

          <!-- Resize handle -->
          <div
            v-if="availableSizes(item.spaceId, item.widgetId).length > 1"
            class="absolute bottom-0 right-0 w-7 h-7 cursor-se-resize group/rz"
            @mousedown.stop="onResizeStart($event, item)"
          >
            <svg class="absolute bottom-1.5 right-1.5 size-3 text-[var(--app-muted)] group-hover/rz:text-[var(--app-accent)] transition-colors" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
              <line x1="14" y1="6" x2="6" y2="14" />
              <line x1="14" y1="11" x2="11" y2="14" />
            </svg>
          </div>
        </div>
      </div>

      <!-- Drop preview ghost (shows where widget will land) -->
      <div
        v-if="dropPreviewStyle"
        :style="dropPreviewStyle"
        class="rounded-xl border-2 border-dashed border-[var(--app-accent)]/60 bg-[var(--app-accent)]/10 pointer-events-none transition-all duration-150"
      />

      <!-- Empty cells: hover "+" -->
      <template v-if="editing && !dragId">
        <div
          v-for="cell in emptyCells"
          :key="`e-${cell.x}-${cell.y}`"
          :style="{ gridColumn: `${cell.x + 1} / span 1`, gridRow: `${cell.y + 1} / span 1` }"
          class="group rounded-xl cursor-pointer"
          @click="emit('addWidget')"
        >
          <div class="h-full flex items-center justify-center rounded-xl border border-dashed border-[var(--app-border)]/40 group-hover:border-[var(--app-accent)]/40 group-hover:bg-[var(--app-accent)]/5 transition-all">
            <Plus class="size-4 text-[var(--app-muted)]/30 group-hover:text-[var(--app-accent)] group-hover:opacity-100 transition-all" />
          </div>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.edit-grid {
  background-image:
    radial-gradient(circle, color-mix(in srgb, var(--app-muted) 15%, transparent) 1px, transparent 1px);
  background-size: calc(100% / v-bind(gridCols)) 82px;
  background-position: center center;
}
</style>
