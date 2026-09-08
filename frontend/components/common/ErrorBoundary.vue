<script setup lang="ts">
/**
 * ErrorBoundary — contains a render/setup/lifecycle error from its subtree so
 * one broken page or space can't blank the whole app. Wraps the page-level
 * <RouterView>; the sidebar/toolbar live OUTSIDE it, so they stay usable and
 * the user can navigate away to recover.
 *
 * onErrorCaptured returning `false` stops the error propagating to the app root
 * (which would otherwise tear down the tree). Keying the boundary by route in
 * the parent resets it on navigation, so moving to another route clears a stuck
 * error automatically.
 *
 * Note: this catches errors thrown during render / setup / lifecycle / watchers
 * — the ones that blank the UI. Unhandled promise rejections from event
 * handlers are caught by installErrorTracker (window.onunhandledrejection) and
 * don't tear down the view, so they don't need to be handled here.
 */
import { computed, onErrorCaptured, ref } from 'vue'
import { RotateCw, House, ChevronDown } from 'lucide-vue-next'

const err = ref<Error | null>(null)
const showDetail = ref(false)
const errorDetail = computed(() =>
  err.value ? err.value.message + (err.value.stack ? '\n\n' + err.value.stack : '') : '',
)

onErrorCaptured((e) => {
  err.value = e instanceof Error ? e : new Error(String(e))
  console.error('[ErrorBoundary] contained a subtree error:', err.value)
  return false
})

function retry() {
  err.value = null
  showDetail.value = false
}

function goHome() {
  err.value = null
  window.location.hash = '#/app'
}

function reload() {
  window.location.reload()
}
</script>

<template>
  <slot v-if="!err" />

  <div
    v-else
    class="h-full w-full flex items-center justify-center p-8"
    style="color: var(--app-foreground)"
  >
    <div class="max-w-md w-full text-center">
      <div
        class="mx-auto mb-5 size-12 rounded-full flex items-center justify-center"
        style="background: color-mix(in srgb, var(--app-accent) 12%, transparent); color: var(--app-accent)"
      >
        <RotateCw class="size-5" />
      </div>

      <h2 class="text-lg font-semibold tracking-tight">Something went wrong here</h2>
      <p class="mt-1.5 text-sm leading-relaxed" style="color: var(--app-muted)">
        This page hit an error, but the rest of the app is fine. Try again, or head back home.
      </p>

      <div class="mt-6 flex items-center justify-center gap-2">
        <button
          class="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition"
          style="background: var(--app-accent); color: var(--app-accent-foreground)"
          @click="retry"
        >
          <RotateCw class="size-4" /> Try again
        </button>
        <button
          class="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium border transition"
          style="border-color: var(--app-border); color: var(--app-foreground)"
          @click="goHome"
        >
          <House class="size-4" /> Home
        </button>
      </div>

      <button
        class="mt-5 inline-flex items-center gap-1 text-[11px] tracking-wide uppercase transition"
        style="color: var(--app-muted)"
        @click="showDetail = !showDetail"
      >
        <ChevronDown class="size-3 transition-transform" :class="showDetail ? 'rotate-180' : ''" />
        {{ showDetail ? 'Hide' : 'Show' }} details
      </button>

      <!-- eslint-disable-next-line vue/multiline-html-element-content-newline -->
      <pre
        v-if="showDetail"
        class="mt-3 text-left text-[11px] font-mono whitespace-pre-wrap break-words rounded-lg p-3 max-h-48 overflow-auto"
        style="background: var(--app-input-bg); color: var(--app-muted); border: 1px solid var(--app-border)"
      >{{ errorDetail }}</pre>

      <button
        class="mt-4 block mx-auto text-[11px] underline"
        style="color: var(--app-muted)"
        @click="reload"
      >
        Still stuck? Reload the app
      </button>
    </div>
  </div>
</template>
