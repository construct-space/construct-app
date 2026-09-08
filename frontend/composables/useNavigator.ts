/**
 * useNavigator — GetX-style imperative routing wrapper.
 *
 * Wraps vue-router's useRouter + useRoute behind the SDK's `Navigator`
 * interface so space bundles can call nav.to('/foo') / nav.back() instead
 * of juggling two composables. The `to()` picker-pattern resolution is
 * supported via a per-route promise map keyed by fullPath.
 */

import { computed, ref } from 'vue'
import type { ComputedRef, Ref } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import type {
  Navigator as NavigatorIface,
  SpaceRoute,
  NavigateOptions,
} from '@construct-space/sdk'

// Per-route picker resolvers — back(result) walks the stack and resolves
// the most-recently-pushed `to()` promise.
const pendingResolvers: Array<(value: unknown) => void> = []
const lastArguments = ref<unknown>(undefined)

function toSpaceRoute(r: ReturnType<typeof useRoute>): SpaceRoute {
  return {
    path: r.path,
    hash: r.hash,
    query: r.query as Record<string, string | (string | null)[] | null | undefined>,
    fullPath: r.fullPath,
    params: r.params as Record<string, string | string[]>,
    name: r.name,
    meta: r.meta as Record<string, unknown>,
  }
}

function normalizeQuery(
  q?: NavigateOptions['query'],
): Record<string, string> | undefined {
  if (!q) return undefined
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(q)) {
    if (v != null) out[k] = String(v)
  }
  return out
}

export function useNavigator(): NavigatorIface {
  const router = useRouter()
  const route = useRoute()

  // Space mount base — e.g. `/app/drive`, `/app/projects/foo/board`. When a
  // space calls `nav.to('/folder-id')` it means "in MY pages", not "at the
  // app root". Without this prefix, the push escapes the space's
  // DynamicSpacePage subtree and breaks both rendering and the toolbar
  // breadcrumb (which keys panel state by route.path).
  function spaceBase(): string {
    const params = route.params as Record<string, string | string[] | undefined>
    const spaceName = Array.isArray(params.spaceName) ? params.spaceName[0] : params.spaceName
    if (!spaceName) return ''
    const path = route.path
    const subPage = Array.isArray(params.subPage) ? params.subPage[0] : params.subPage
    if (subPage) {
      // Strip the subPage suffix to recover the mount base.
      const idx = path.lastIndexOf('/' + subPage)
      if (idx >= 0) return path.slice(0, idx)
    }
    // No subPage — the current path IS the base (trim trailing slash).
    return path.replace(/\/+$/, '')
  }

  function scopePath(path: string): string {
    if (!path.startsWith('/')) return path
    const base = spaceBase()
    if (!base) return path
    if (path === '/') return base
    return base + path
  }

  // Expose path/fullPath as space-relative so spaces can treat their own
  // routes as if they were a mini-app. A space mounted at /app/drive
  // sees `path` as `/` at root and `/folder-id` for subPage routes.
  const current: Ref<SpaceRoute> = computed(() => {
    const base = spaceBase()
    const r = toSpaceRoute(route)
    if (!base) return r
    const stripped = r.path.startsWith(base) ? (r.path.slice(base.length) || '/') : r.path
    return {
      ...r,
      path: stripped,
      fullPath: stripped + (r.fullPath.slice(r.path.length) || ''),
    }
  }) as unknown as Ref<SpaceRoute>
  const params: ComputedRef<Record<string, string>> = computed(() => {
    const out: Record<string, string> = {}
    for (const [k, v] of Object.entries(route.params)) {
      out[k] = Array.isArray(v) ? (v[0] ?? '') : String(v ?? '')
    }
    return out
  })
  const query: ComputedRef<Record<string, string>> = computed(() => {
    const out: Record<string, string> = {}
    for (const [k, v] of Object.entries(route.query)) {
      if (v == null) continue
      out[k] = Array.isArray(v) ? String(v[0] ?? '') : String(v)
    }
    return out
  })

  const argumentsRef: ComputedRef<unknown> = computed(() => lastArguments.value)

  function buildTarget(path: string, opts?: NavigateOptions) {
    const target: { path: string; hash?: string; query?: Record<string, string> } = { path: scopePath(path) }
    if (opts?.hash !== undefined) target.hash = opts.hash
    const q = normalizeQuery(opts?.query)
    if (q) target.query = q
    if (opts && 'arguments' in opts) lastArguments.value = opts.arguments
    return target
  }

  return {
    current,
    params,
    query,
    arguments: argumentsRef,

    async to<T = unknown>(path: string, opts?: NavigateOptions): Promise<T | undefined> {
      await router.push(buildTarget(path, opts))
      return new Promise<T | undefined>((resolve) => {
        pendingResolvers.push(resolve as (v: unknown) => void)
      })
    },

    async off(path: string, opts?: NavigateOptions): Promise<void> {
      await router.replace(buildTarget(path, opts))
    },

    async offAll(path: string, opts?: NavigateOptions): Promise<void> {
      // No router API to pop "all" — replace is the closest single-step equiv.
      while (pendingResolvers.length > 0) pendingResolvers.pop()!(undefined)
      await router.replace(buildTarget(path, opts))
    },

    back<T = unknown>(result?: T): void {
      const resolver = pendingResolvers.pop()
      if (resolver) resolver(result)
      router.back()
    },

    until(predicate: (route: SpaceRoute) => boolean): void {
      // Vue Router has no native "pop until" — best-effort single back().
      if (!predicate(toSpaceRoute(route))) router.back()
    },

    forward(): void {
      router.forward()
    },

    go(delta: number): void {
      router.go(delta)
    },

    isCurrent(path: string): boolean {
      return route.path === path
    },
  }
}
