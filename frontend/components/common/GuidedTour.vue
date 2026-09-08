<script setup lang="ts">
/**
 * GuidedTour — tooltip-style walkthrough.
 *
 * Each step anchors to an element via `target` (CSS selector). The popover
 * positions itself near the resolved element, draws an arrow back at it,
 * and adds a ring highlight on the target for the duration of the step.
 * If a target can't be resolved (element not mounted / hidden behind a
 * route change), the step falls back to a screen-centered popover so the
 * tour can still advance instead of stalling.
 */

import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { X } from 'lucide-vue-next'

export interface TourStep {
  target?: string
  title: string
  description: string
  /** Badge text rendered in the left-side avatar. Defaults to the step number. */
  badge?: string
  /** Preferred placement; auto-flips if it'd overflow the viewport. */
  placement?: 'top' | 'bottom' | 'left' | 'right'
}

const props = defineProps<{
  modelValue: boolean
  steps: TourStep[]
  /** Label for the last step's primary button. Defaults to "Got it!". */
  finishLabel?: string
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  finish: []
  skip: []
}>()

const stepIndex = ref(0)
const anchor = ref<{
  x: number
  y: number
  placement: 'above' | 'below' | 'center'
  arrowSide: 'left' | 'right'
} | null>(null)
const highlighted = ref<HTMLElement | null>(null)
const popoverRef = ref<HTMLElement | null>(null)

const currentStep = computed(() => props.steps[stepIndex.value])
const isLast = computed(() => stepIndex.value === props.steps.length - 1)
const isFirst = computed(() => stepIndex.value === 0)

const POPOVER_W = 360
// Conservative initial estimate; `measuredHeight` replaces it after the
// popover mounts so long-copy steps don't end up overlapping the target.
const POPOVER_H_ESTIMATE = 200
const GAP = 14
const measuredHeight = ref(POPOVER_H_ESTIMATE)

function resolveTarget(selector?: string): HTMLElement | null {
  if (!selector) return null
  return document.querySelector(selector) as HTMLElement | null
}

function clearHighlight() {
  if (highlighted.value) {
    highlighted.value.classList.remove('tour-target-highlight')
    highlighted.value = null
  }
}

function highlight(el: HTMLElement | null) {
  clearHighlight()
  if (el) {
    el.classList.add('tour-target-highlight')
    highlighted.value = el
    el.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' })
  }
}

// Chat-bubble placement: the popover sits above the target with an arrow
// pointing down at it. The arrow corner tracks the target — if the target
// is on the right half of the screen the popover extends leftward with a
// right-side arrow; left-half targets get the mirror. Falls back to
// bottom-placement if the popover would clip the top, and dead-centre
// if nothing fits.
// Arrow is 20px wide (10px transparent border on each side); inset by 24px
// from the popover's side. Its tip sits 24 + 10 = 34px from that edge.
const ARROW_INSET = 24
const ARROW_HALF_W = 10
const ARROW_TIP_FROM_EDGE = ARROW_INSET + ARROW_HALF_W
function computeAnchor(step: TourStep | undefined) {
  if (!step) { anchor.value = null; return }
  const el = resolveTarget(step.target)
  highlight(el)
  if (!el) { anchor.value = null; return }

  const rect = el.getBoundingClientRect()
  const vw = window.innerWidth
  const vh = window.innerHeight
  const h = measuredHeight.value

  const targetCenterX = rect.left + rect.width / 2
  const targetIsOnRightSide = targetCenterX > vw / 2

  // Pick which corner the arrow comes out of and lay the popover on the
  // opposite side of the target. `ARROW_OFFSET` matches the CSS inset of
  // the arrow so the tail lands near the target's horizontal centre.
  let x: number
  const arrowSide: 'left' | 'right' = targetIsOnRightSide ? 'right' : 'left'
  if (targetIsOnRightSide) {
    x = targetCenterX - POPOVER_W + ARROW_TIP_FROM_EDGE
  } else {
    x = targetCenterX - ARROW_TIP_FROM_EDGE
  }
  let y = rect.top - h - GAP

  x = Math.max(8, Math.min(vw - POPOVER_W - 8, x))

  // Target is too high to fit a popover above → drop below.
  const fallbackBelow = y < 8
  if (fallbackBelow) {
    y = rect.bottom + GAP
    if (y + h > vh) {
      anchor.value = {
        x: vw / 2 - POPOVER_W / 2,
        y: vh / 2 - h / 2,
        placement: 'center',
        arrowSide,
      }
      return
    }
    anchor.value = { x, y, placement: 'below', arrowSide }
    return
  }

  anchor.value = { x, y, placement: 'above', arrowSide }
}

// After the popover renders, measure its actual height. If it's bigger
// than our estimate, reposition so the target isn't occluded.
function remeasure() {
  const el = popoverRef.value
  if (!el) return
  const h = el.offsetHeight
  if (h > 0 && Math.abs(h - measuredHeight.value) > 4) {
    measuredHeight.value = h
    computeAnchor(currentStep.value)
  }
}

function next() {
  if (isLast.value) {
    finish()
  } else {
    stepIndex.value += 1
  }
}

function prev() {
  if (!isFirst.value) stepIndex.value -= 1
}

function finish() {
  clearHighlight()
  emit('update:modelValue', false)
  emit('finish')
}

function skip() {
  clearHighlight()
  emit('update:modelValue', false)
  emit('skip')
}

watch(stepIndex, () => {
  nextTick(() => {
    computeAnchor(currentStep.value)
    // Let the new copy render, then re-measure and re-position if it's
    // taller than the estimate (prevents the popover from covering the
    // target on long-description steps).
    nextTick(remeasure)
  })
})

watch(() => props.modelValue, (open) => {
  if (open) {
    stepIndex.value = 0
    nextTick(() => {
      computeAnchor(currentStep.value)
      nextTick(remeasure)
    })
  } else {
    clearHighlight()
  }
})

function onResize() {
  if (props.modelValue) {
    computeAnchor(currentStep.value)
    nextTick(remeasure)
  }
}

onMounted(() => {
  window.addEventListener('resize', onResize)
  window.addEventListener('scroll', onResize, true)
  if (props.modelValue) {
    nextTick(() => {
      computeAnchor(currentStep.value)
      nextTick(remeasure)
    })
  }
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', onResize)
  window.removeEventListener('scroll', onResize, true)
  clearHighlight()
})

const popoverStyle = computed(() => {
  if (!anchor.value) return { opacity: '0' }
  return {
    left: `${anchor.value.x}px`,
    top: `${anchor.value.y}px`,
  }
})
</script>

<template>
  <Teleport to="body">
    <div v-if="modelValue" class="tour-root" aria-live="polite">
      <!-- Popover -->
      <div
        v-if="currentStep"
        ref="popoverRef"
        class="tour-popover"
        :data-placement="anchor?.placement || 'above'"
        :data-arrow-side="anchor?.arrowSide || 'right'"
        :style="popoverStyle"
        role="dialog"
        aria-modal="false"
      >
        <button type="button" class="tour-close" aria-label="Close" @click="skip">
          <X class="size-4" />
        </button>

        <div class="tour-body">
          <div class="tour-badge">
            {{ currentStep.badge || (stepIndex + 1) }}
          </div>
          <div class="tour-text">
            <p class="tour-title" v-html="currentStep.title" />
            <p class="tour-desc" v-html="currentStep.description" />
          </div>
        </div>

        <div class="tour-footer">
          <button type="button" class="tour-skip" @click="skip">Skip</button>
          <div class="tour-actions">
            <button
              type="button"
              class="tour-btn tour-btn--ghost"
              :disabled="isFirst"
              @click="prev"
            >
              Previous
            </button>
            <button type="button" class="tour-btn tour-btn--primary" @click="next">
              {{ isLast ? (finishLabel || 'Got it!') : 'Next' }}
            </button>
          </div>
        </div>

        <!-- Step progress pips -->
        <div class="tour-pips">
          <span
            v-for="(_, i) in steps"
            :key="i"
            class="tour-pip"
            :class="{ 'tour-pip--active': i === stepIndex }"
          />
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style>
/* Target-side highlight lives globally so it can reach elements rendered
   anywhere in the tree. Uses the app accent so it tracks theme changes. */
.tour-target-highlight {
  position: relative;
  z-index: 9100;
  box-shadow:
    0 0 0 2px var(--app-accent),
    0 0 0 6px color-mix(in srgb, var(--app-accent) 25%, transparent);
  border-radius: 10px;
  transition: box-shadow 0.2s ease;
}
</style>

<style scoped>
.tour-root {
  position: fixed;
  inset: 0;
  z-index: 9200;
  pointer-events: none;
}

.tour-popover {
  --tour-surface: var(--app-card, var(--app-background, #1b1f2a));
  --tour-border: var(--app-border, color-mix(in srgb, var(--app-accent) 20%, transparent));
  --tour-fg: var(--app-foreground, #f1f5f9);
  --tour-muted: var(--app-muted, #94a3b8);
  --tour-body-bg: color-mix(in srgb, var(--tour-surface) 92%, transparent);

  position: fixed;
  width: 360px;
  background: var(--tour-surface);
  color: var(--tour-fg);
  border: 1px solid var(--tour-border);
  border-radius: 14px;
  box-shadow: 0 24px 64px -12px rgba(0, 0, 0, 0.45);
  padding: 20px 20px 16px;
  pointer-events: auto;
  /* Own stacking context so ::before z-index: -1 stays scoped to the
     popover — the triangle renders behind the card surface but above the
     page, instead of disappearing behind everything. */
  isolation: isolate;
  transition: left 0.18s ease, top 0.18s ease, opacity 0.18s ease;
}

/* Chat-bubble arrow. `data-arrow-side` picks which corner it comes out of
   — right-side targets put the arrow on the popover's right edge, left-side
   targets put it on the left. The anchor logic keeps the arrow landing
   near the target's horizontal centre. */
.tour-popover::before {
  content: '';
  position: absolute;
  z-index: -1;
  width: 0;
  height: 0;
  border-left: 10px solid transparent;
  border-right: 10px solid transparent;
}
.tour-popover[data-arrow-side="right"]::before { right: 24px; }
.tour-popover[data-arrow-side="left"]::before  { left: 24px; }
.tour-popover[data-placement="above"]::before {
  bottom: -8px;
  border-top: 12px solid var(--tour-surface);
}
.tour-popover[data-placement="below"]::before {
  top: -8px;
  border-bottom: 12px solid var(--tour-surface);
}
.tour-popover[data-placement="center"]::before { display: none; }

.tour-close {
  position: absolute;
  top: 12px;
  right: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: 6px;
  color: var(--tour-muted);
  background: transparent;
  border: 0;
  cursor: pointer;
  transition: color 0.15s, background 0.15s;
}
.tour-close:hover {
  color: var(--tour-fg);
  background: color-mix(in srgb, var(--tour-muted) 15%, transparent);
}

.tour-body {
  display: flex;
  gap: 14px;
  align-items: flex-start;
  padding-right: 24px;
}

.tour-badge {
  flex-shrink: 0;
  width: 48px;
  height: 48px;
  border-radius: 50%;
  background: color-mix(in srgb, var(--app-accent) 18%, transparent);
  color: var(--app-accent);
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 600;
  font-size: 14px;
  text-transform: lowercase;
}

.tour-text { flex: 1; min-width: 0; }
.tour-title { font-size: 14px; line-height: 1.4; margin: 2px 0 6px; color: var(--tour-fg); }
.tour-title :deep(strong) { color: var(--app-accent); font-weight: 600; }
.tour-desc  { font-size: 13px; line-height: 1.5; color: var(--tour-muted); margin: 0; }
.tour-desc :deep(strong) { color: var(--tour-fg); font-weight: 600; }

.tour-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 18px;
}

.tour-skip {
  background: transparent;
  border: 0;
  color: var(--app-accent);
  font-size: 13px;
  cursor: pointer;
  padding: 6px 4px;
}
.tour-skip:hover { text-decoration: underline; }

.tour-actions { display: flex; gap: 8px; }

.tour-btn {
  padding: 8px 16px;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.15s, opacity 0.15s, border-color 0.15s;
}
.tour-btn:disabled { opacity: 0.4; cursor: not-allowed; }

.tour-btn--ghost {
  background: transparent;
  color: var(--tour-fg);
  border: 1px solid color-mix(in srgb, var(--app-accent) 45%, transparent);
}
.tour-btn--ghost:not(:disabled):hover { border-color: var(--app-accent); }

.tour-btn--primary {
  background: var(--app-accent);
  color: var(--app-accent-foreground, #ffffff);
  border: 1px solid var(--app-accent);
}
.tour-btn--primary:hover { opacity: 0.92; }

.tour-pips {
  display: flex;
  gap: 4px;
  justify-content: center;
  margin-top: 12px;
}
.tour-pip {
  width: 6px;
  height: 6px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--tour-muted) 35%, transparent);
  transition: background 0.15s, width 0.15s;
}
.tour-pip--active {
  width: 18px;
  background: var(--app-accent);
}
</style>
