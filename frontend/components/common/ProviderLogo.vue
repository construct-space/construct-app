<script setup lang="ts">
/**
 * ProviderLogo — inlines a provider SVG and trims its viewBox to the
 * actual content bounds via getBBox() after mount. Many provider logos
 * (anthropic, deepseek, etc.) ship with 30–50% padding baked into their
 * viewBox; this trim removes that whitespace so the logo aligns tightly
 * with the title.
 *
 * Color inherits from the parent `text-*` class (SVGs are normalized to
 * `fill="currentColor"` at import time in @/lib/providerLogo).
 */
import { nextTick, onMounted, ref, watch, computed } from 'vue'
import { providerLogoSvg } from '@/lib/providerLogo'

const props = defineProps<{ id: string }>()

const wrapperRef = ref<HTMLElement | null>(null)
const svg = computed(() => providerLogoSvg(props.id))

async function trim() {
  await nextTick()
  const el = wrapperRef.value?.querySelector('svg') as SVGSVGElement | null
  if (!el) return
  try {
    // getBBox requires the element to be rendered; nextTick gives it a
    // frame. Some SVGs with 0-size ignore the call — guard for that.
    const bbox = (el as unknown as SVGGraphicsElement).getBBox()
    if (bbox.width > 0 && bbox.height > 0) {
      const pad = 0
      el.setAttribute(
        'viewBox',
        `${bbox.x - pad} ${bbox.y - pad} ${bbox.width + pad * 2} ${bbox.height + pad * 2}`,
      )
      el.setAttribute('preserveAspectRatio', 'xMidYMid meet')
    }
  } catch { /* element not yet rendered */ }
}

onMounted(trim)
watch(() => props.id, () => { trim() })
</script>

<template>
  <span v-if="svg" ref="wrapperRef" class="inline-block" v-html="svg" />
</template>
