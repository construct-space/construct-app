/**
 * useBreadcrumb — the SDK-facing breadcrumb trail API (most spaces use this).
 *
 * The toolbar renderer (toolbar/Breadcrumb.vue) reads the breadcrumbs the
 * toolbar's panel system carries (set via useToolbar().setBreadcrumbs), which
 * is what participates in cube rotation, pending-on-mount staging, and
 * clear-on-navigation. A standalone trail ref would render nowhere. So this
 * composable keeps its own reactive trail (for `trail`/push/pop convenience)
 * and forwards every change into the toolbar via setBreadcrumbs — making the
 * documented useBreadcrumb() API drive the same path host pages use.
 *
 * useToolbar() registers a route watcher, but navigateWithRotation() guards on
 * previousPath/isRotating and clearTransientToolbarContent() is idempotent, so
 * the extra caller is safe (spaces already call useToolbar() + useBreadcrumb()
 * side by side). Wrapped in try/catch for the rare non-setup caller, where it
 * degrades to trail-only with no bridge.
 */

import { computed, ref } from 'vue'
import type { ComputedRef } from 'vue'
import { useToolbar } from '@/composables/useToolbar'

export interface BreadcrumbOption {
  label: string
  /** Path inside this space; selecting navigates here (like a crumb `to`). */
  to: string
}

export interface Breadcrumb {
  label: string
  icon?: string
  iconColor?: string
  /** Path inside this space. Clicking the crumb calls nav.to(to). */
  to?: string
  /** When set, the crumb renders as a dropdown of sibling destinations
   *  (e.g. a board / record switcher). Selecting one navigates to its `to`. */
  options?: BreadcrumbOption[]
}

const trailRef = ref<Breadcrumb[]>([])

export function useBreadcrumb() {
  const trail: ComputedRef<Breadcrumb[]> = computed(() => trailRef.value)

  let toolbar: ReturnType<typeof useToolbar> | null = null
  try { toolbar = useToolbar() } catch { toolbar = null }

  function sync() {
    toolbar?.setBreadcrumbs(trailRef.value.map(b => ({
      label: b.label,
      icon: b.icon,
      iconColor: b.iconColor,
      to: b.to,
      options: b.options,
    })))
  }

  function set(items: Breadcrumb[]) {
    trailRef.value = [...items]
    sync()
  }

  function push(item: Breadcrumb) {
    trailRef.value = [...trailRef.value, item]
    sync()
  }

  function pop(): Breadcrumb | undefined {
    const next = [...trailRef.value]
    const last = next.pop()
    trailRef.value = next
    sync()
    return last
  }

  function clear() {
    trailRef.value = []
    sync()
  }

  return { trail, set, push, pop, clear }
}
