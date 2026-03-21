<script setup lang="ts">
/**
 * ColorPicker — Construct UI
 * Self-contained color picker with HSV square, hue slider, optional alpha,
 * hex input, and preset swatches. No external color libraries.
 */
import {
  PopoverRoot,
  PopoverTrigger,
  PopoverPortal,
  PopoverContent,
} from 'reka-ui'

// ---------------------------------------------------------------------------
// Props & Emits
// ---------------------------------------------------------------------------

const props = withDefaults(defineProps<{
  modelValue?: string
  size?: 'sm' | 'md' | 'lg'
  disabled?: boolean
  alpha?: boolean
  presets?: string[]
}>(), {
  modelValue: '#FF0000',
  size: 'md',
  disabled: false,
  alpha: false,
  presets: () => [],
})

const emit = defineEmits<{
  'update:modelValue': [value: string]
  'change': [value: string]
}>()

// ---------------------------------------------------------------------------
// Color math — HSV <-> RGB <-> Hex
// ---------------------------------------------------------------------------

interface HSV { h: number; s: number; v: number }
interface HSVA extends HSV { a: number }
interface RGB { r: number; g: number; b: number }
interface RGBA extends RGB { a: number }

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v))
}

function hsvToRgb(h: number, s: number, v: number): RGB {
  h = ((h % 360) + 360) % 360
  s = clamp(s, 0, 1)
  v = clamp(v, 0, 1)
  const c = v * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = v - c
  let r = 0, g = 0, b = 0
  if (h < 60)      { r = c; g = x; b = 0 }
  else if (h < 120) { r = x; g = c; b = 0 }
  else if (h < 180) { r = 0; g = c; b = x }
  else if (h < 240) { r = 0; g = x; b = c }
  else if (h < 300) { r = x; g = 0; b = c }
  else              { r = c; g = 0; b = x }
  return {
    r: Math.round((r + m) * 255),
    g: Math.round((g + m) * 255),
    b: Math.round((b + m) * 255),
  }
}

function rgbToHsv(r: number, g: number, b: number): HSV {
  r /= 255; g /= 255; b /= 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const d = max - min
  let h = 0
  if (d !== 0) {
    if (max === r) h = 60 * (((g - b) / d) % 6)
    else if (max === g) h = 60 * ((b - r) / d + 2)
    else h = 60 * ((r - g) / d + 4)
  }
  if (h < 0) h += 360
  const s = max === 0 ? 0 : d / max
  return { h, s, v: max }
}

function rgbaToHex(r: number, g: number, b: number, a?: number): string {
  const hex = '#' + [r, g, b].map(c => c.toString(16).padStart(2, '0')).join('').toUpperCase()
  if (a !== undefined && a < 1) {
    return hex + Math.round(a * 255).toString(16).padStart(2, '0').toUpperCase()
  }
  return hex
}

function parseHex(hex: string): RGBA {
  let h = hex.replace(/^#/, '')
  // Expand shorthand (#RGB or #RGBA)
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2]
  if (h.length === 4) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2] + h[3] + h[3]
  const r = parseInt(h.slice(0, 2), 16) || 0
  const g = parseInt(h.slice(2, 4), 16) || 0
  const b = parseInt(h.slice(4, 6), 16) || 0
  const a = h.length >= 8 ? (parseInt(h.slice(6, 8), 16) / 255) : 1
  return { r, g, b, a }
}

// ---------------------------------------------------------------------------
// Reactive state
// ---------------------------------------------------------------------------

const popoverOpen = ref(false)

const hsva = reactive<HSVA>({ h: 0, s: 1, v: 1, a: 1 })
const hexInput = ref('')

// Sync from modelValue prop
function syncFromProp(val: string) {
  const rgba = parseHex(val)
  const { h, s, v } = rgbToHsv(rgba.r, rgba.g, rgba.b)
  // Preserve hue when s=0 or v=0
  if (s > 0.001 && v > 0.001) hsva.h = h
  hsva.s = s
  hsva.v = v
  hsva.a = rgba.a
  hexInput.value = val.toUpperCase().replace(/^#/, '')
}

// Initial sync
syncFromProp(props.modelValue)

watch(() => props.modelValue, (val) => {
  syncFromProp(val)
})

function currentHex(): string {
  const rgb = hsvToRgb(hsva.h, hsva.s, hsva.v)
  return rgbaToHex(rgb.r, rgb.g, rgb.b, props.alpha ? hsva.a : undefined)
}

function emitColor() {
  const hex = currentHex()
  hexInput.value = hex.replace(/^#/, '')
  emit('update:modelValue', hex)
  emit('change', hex)
}

// ---------------------------------------------------------------------------
// Saturation / Brightness square interaction
// ---------------------------------------------------------------------------

const svBoxRef = ref<HTMLElement | null>(null)
let svDragging = false

function updateSV(e: MouseEvent | TouchEvent) {
  const el = svBoxRef.value
  if (!el) return
  const rect = el.getBoundingClientRect()
  const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX
  const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY
  hsva.s = clamp((clientX - rect.left) / rect.width, 0, 1)
  hsva.v = clamp(1 - (clientY - rect.top) / rect.height, 0, 1)
  emitColor()
}

function onSVDown(e: MouseEvent | TouchEvent) {
  if (props.disabled) return
  e.preventDefault()
  svDragging = true
  updateSV(e)
  window.addEventListener('mousemove', onSVMove)
  window.addEventListener('mouseup', onSVUp)
  window.addEventListener('touchmove', onSVMove)
  window.addEventListener('touchend', onSVUp)
}

function onSVMove(e: MouseEvent | TouchEvent) {
  if (!svDragging) return
  e.preventDefault()
  updateSV(e)
}

function onSVUp() {
  svDragging = false
  window.removeEventListener('mousemove', onSVMove)
  window.removeEventListener('mouseup', onSVUp)
  window.removeEventListener('touchmove', onSVMove)
  window.removeEventListener('touchend', onSVUp)
}

// ---------------------------------------------------------------------------
// Hue slider interaction
// ---------------------------------------------------------------------------

const hueRef = ref<HTMLElement | null>(null)
let hueDragging = false

function updateHue(e: MouseEvent | TouchEvent) {
  const el = hueRef.value
  if (!el) return
  const rect = el.getBoundingClientRect()
  const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX
  hsva.h = clamp(((clientX - rect.left) / rect.width) * 360, 0, 360)
  emitColor()
}

function onHueDown(e: MouseEvent | TouchEvent) {
  if (props.disabled) return
  e.preventDefault()
  hueDragging = true
  updateHue(e)
  window.addEventListener('mousemove', onHueMove)
  window.addEventListener('mouseup', onHueUp)
  window.addEventListener('touchmove', onHueMove)
  window.addEventListener('touchend', onHueUp)
}

function onHueMove(e: MouseEvent | TouchEvent) {
  if (!hueDragging) return
  e.preventDefault()
  updateHue(e)
}

function onHueUp() {
  hueDragging = false
  window.removeEventListener('mousemove', onHueMove)
  window.removeEventListener('mouseup', onHueUp)
  window.removeEventListener('touchmove', onHueMove)
  window.removeEventListener('touchend', onHueUp)
}

// ---------------------------------------------------------------------------
// Alpha slider interaction
// ---------------------------------------------------------------------------

const alphaRef = ref<HTMLElement | null>(null)
let alphaDragging = false

function updateAlpha(e: MouseEvent | TouchEvent) {
  const el = alphaRef.value
  if (!el) return
  const rect = el.getBoundingClientRect()
  const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX
  hsva.a = clamp((clientX - rect.left) / rect.width, 0, 1)
  emitColor()
}

function onAlphaDown(e: MouseEvent | TouchEvent) {
  if (props.disabled) return
  e.preventDefault()
  alphaDragging = true
  updateAlpha(e)
  window.addEventListener('mousemove', onAlphaMove)
  window.addEventListener('mouseup', onAlphaUp)
  window.addEventListener('touchmove', onAlphaMove)
  window.addEventListener('touchend', onAlphaUp)
}

function onAlphaMove(e: MouseEvent | TouchEvent) {
  if (!alphaDragging) return
  e.preventDefault()
  updateAlpha(e)
}

function onAlphaUp() {
  alphaDragging = false
  window.removeEventListener('mousemove', onAlphaMove)
  window.removeEventListener('mouseup', onAlphaUp)
  window.removeEventListener('touchmove', onAlphaMove)
  window.removeEventListener('touchend', onAlphaUp)
}

// ---------------------------------------------------------------------------
// Hex input
// ---------------------------------------------------------------------------

function onHexInput(e: Event) {
  const val = (e.target as HTMLInputElement).value.replace(/[^0-9A-Fa-f]/g, '').slice(0, props.alpha ? 8 : 6)
  hexInput.value = val
  if (val.length === 6 || (props.alpha && val.length === 8)) {
    syncFromProp('#' + val)
    const hex = currentHex()
    emit('update:modelValue', hex)
    emit('change', hex)
  }
}

// ---------------------------------------------------------------------------
// Preset click
// ---------------------------------------------------------------------------

function selectPreset(color: string) {
  if (props.disabled) return
  syncFromProp(color)
  emitColor()
}

// ---------------------------------------------------------------------------
// Computed styles
// ---------------------------------------------------------------------------

const swatchBg = computed(() => {
  const rgb = hsvToRgb(hsva.h, hsva.s, hsva.v)
  if (props.alpha) {
    return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${hsva.a})`
  }
  return rgbaToHex(rgb.r, rgb.g, rgb.b)
})

const hueColor = computed(() => {
  const rgb = hsvToRgb(hsva.h, 1, 1)
  return `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`
})

const alphaGradient = computed(() => {
  const rgb = hsvToRgb(hsva.h, hsva.s, hsva.v)
  return `linear-gradient(to right, rgba(${rgb.r},${rgb.g},${rgb.b},0), rgb(${rgb.r},${rgb.g},${rgb.b}))`
})

const svThumbStyle = computed(() => ({
  left: `${hsva.s * 100}%`,
  top: `${(1 - hsva.v) * 100}%`,
}))

const hueThumbStyle = computed(() => ({
  left: `${(hsva.h / 360) * 100}%`,
}))

const alphaThumbStyle = computed(() => ({
  left: `${hsva.a * 100}%`,
}))

// Size maps
const swatchSize: Record<string, string> = {
  sm: 'size-6',
  md: 'size-8',
  lg: 'size-10',
}

const swatchRound: Record<string, string> = {
  sm: 'rounded',
  md: 'rounded-md',
  lg: 'rounded-lg',
}

const panelWidth: Record<string, string> = {
  sm: 'w-52',
  md: 'w-60',
  lg: 'w-72',
}

const svHeight: Record<string, string> = {
  sm: 'h-32',
  md: 'h-40',
  lg: 'h-52',
}
</script>

<template>
  <PopoverRoot v-model:open="popoverOpen">
    <PopoverTrigger as-child>
      <!-- Swatch button -->
      <button
        type="button"
        :disabled="disabled"
        :class="[
          'inline-flex items-center justify-center border border-[var(--app-border)] transition-colors duration-150 cursor-pointer',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-accent)] focus-visible:ring-offset-1',
          'disabled:opacity-50 disabled:cursor-not-allowed',
          'hover:border-[var(--app-muted)]',
          swatchSize[size],
          swatchRound[size],
        ]"
        :style="{ backgroundColor: swatchBg }"
        :aria-label="`Color picker: ${currentHex()}`"
      >
        <!-- Checkerboard behind swatch for alpha visibility -->
        <span
          v-if="alpha"
          class="absolute inset-0 -z-10 rounded-[inherit]"
          style="background-image: conic-gradient(#80808040 0 25%, transparent 0 50%, #80808040 0 75%, transparent 0); background-size: 8px 8px;"
        />
      </button>
    </PopoverTrigger>

    <PopoverPortal>
      <PopoverContent
        side="bottom"
        :side-offset="6"
        align="start"
        :class="[
          'z-[100] rounded-lg border border-[var(--app-border)] bg-[var(--app-background)] shadow-xl p-3 space-y-3',
          'animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95',
          panelWidth[size],
        ]"
      >
        <!-- Saturation / Brightness square -->
        <div
          ref="svBoxRef"
          :class="['relative w-full rounded-md cursor-crosshair select-none overflow-hidden', svHeight[size]]"
          :style="{ backgroundColor: hueColor }"
          @mousedown="onSVDown"
          @touchstart.passive="onSVDown"
        >
          <!-- White gradient (left to right) -->
          <div class="absolute inset-0" style="background: linear-gradient(to right, #fff, transparent);" />
          <!-- Black gradient (top to bottom) -->
          <div class="absolute inset-0" style="background: linear-gradient(to bottom, transparent, #000);" />
          <!-- Thumb -->
          <div
            class="absolute size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,0.3)] pointer-events-none"
            :style="svThumbStyle"
          />
        </div>

        <!-- Hue slider -->
        <div
          ref="hueRef"
          class="relative w-full h-3 rounded-full cursor-pointer select-none"
          style="background: linear-gradient(to right, #f00 0%, #ff0 17%, #0f0 33%, #0ff 50%, #00f 67%, #f0f 83%, #f00 100%);"
          @mousedown="onHueDown"
          @touchstart.passive="onHueDown"
        >
          <div
            class="absolute top-1/2 size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,0.3)] pointer-events-none"
            :style="{ ...hueThumbStyle, backgroundColor: hueColor }"
          />
        </div>

        <!-- Alpha slider -->
        <div
          v-if="alpha"
          ref="alphaRef"
          class="relative w-full h-3 rounded-full cursor-pointer select-none overflow-hidden"
          @mousedown="onAlphaDown"
          @touchstart.passive="onAlphaDown"
        >
          <!-- Checkerboard -->
          <div
            class="absolute inset-0 rounded-full"
            style="background-image: conic-gradient(#80808040 0 25%, transparent 0 50%, #80808040 0 75%, transparent 0); background-size: 8px 8px;"
          />
          <!-- Gradient overlay -->
          <div class="absolute inset-0 rounded-full" :style="{ background: alphaGradient }" />
          <!-- Thumb -->
          <div
            class="absolute top-1/2 size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,0.3)] pointer-events-none"
            :style="alphaThumbStyle"
          />
        </div>

        <!-- Hex input + preview -->
        <div class="flex items-center gap-2">
          <div
            class="shrink-0 size-8 rounded-md border border-[var(--app-border)]"
            :style="{ backgroundColor: swatchBg }"
          />
          <div
            class="flex-1 flex items-center rounded-md border border-[var(--app-border)] bg-[color-mix(in_srgb,var(--app-background)_80%,var(--app-canvas-bg)_20%)] overflow-hidden"
          >
            <span class="shrink-0 px-2 py-1 text-xs text-[var(--app-muted)] font-medium select-none border-r border-[var(--app-border)]">#</span>
            <input
              type="text"
              :value="hexInput"
              :maxlength="alpha ? 8 : 6"
              class="flex-1 min-w-0 bg-transparent text-[var(--app-foreground)] text-xs px-2 py-1 outline-none font-mono uppercase placeholder:text-[var(--app-muted)]/50"
              :placeholder="alpha ? 'FF2D55FF' : 'FF2D55'"
              :disabled="disabled"
              @input="onHexInput"
            />
          </div>
        </div>

        <!-- Preset swatches -->
        <div v-if="presets.length > 0" class="flex flex-wrap gap-1.5">
          <button
            v-for="color in presets"
            :key="color"
            type="button"
            :disabled="disabled"
            class="size-6 rounded border border-[var(--app-border)] cursor-pointer transition-transform hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-accent)] disabled:opacity-50 disabled:cursor-not-allowed"
            :style="{ backgroundColor: color }"
            :title="color"
            @click="selectPreset(color)"
          />
        </div>
      </PopoverContent>
    </PopoverPortal>
  </PopoverRoot>
</template>
