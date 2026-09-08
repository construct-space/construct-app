export interface WidgetTheme {
  mode: 'dark' | 'light'
  vars: Record<string, string>
}

export interface WidgetSpace {
  id: string
  name: string
  icon: string
}

export interface WidgetActions {
  navigate: (path: string) => void
  newSession: (params?: Record<string, unknown>) => void
}

/** A scheduled task as a widget needs to read it - server truth, scoped to the
 *  widget's own space. Used by clock's Timer/Alarm widgets etc. so they reflect
 *  cron tasks that fire even when the app is closed, without a stale cache. */
export interface WidgetScheduledTask {
  id: string
  enabled: boolean
  nextRunAt?: string
  schedule: unknown
  action: unknown
}

export interface WidgetScheduler {
  /** List this space's scheduled tasks (read-only). */
  list: () => Promise<WidgetScheduledTask[]>
}

export interface BuiltinWidgetApi {
  /** Stable per-placement id (one per widget on the home grid). Use it as a
   * key when persisting per-instance state (e.g. which city this clock shows). */
  instanceId: string
  theme: WidgetTheme
  space: WidgetSpace
  actions: WidgetActions
  /** Open this widget's own space, optionally at a page path (manifest page,
   *  e.g. 'queue' or 'show/123'). Host-mediated — the sandbox has no router. */
  openSpace: (page?: string) => void
  /** Read-only scheduler scoped to this space. Undefined if unavailable. */
  scheduler?: WidgetScheduler
}

export interface MarketplaceWidgetApi {
  /** Stable per-placement id (one per widget on the home grid). Use it as a
   * key when persisting per-instance state. */
  instanceId: string
  theme: WidgetTheme
  space: WidgetSpace
  /** Open this widget's own space, optionally at a page path (manifest page,
   *  e.g. 'queue' or 'show/123'). Host-mediated — the sandbox has no router. */
  openSpace: (page?: string) => void
  /** Read-only scheduler scoped to this space. Undefined if unavailable. */
  scheduler?: WidgetScheduler
}

export type WidgetApi = BuiltinWidgetApi | MarketplaceWidgetApi

export function createBuiltinWidgetApi(opts: {
  instanceId: string
  theme: WidgetTheme
  space: WidgetSpace
  actions: WidgetActions
  openSpace: (page?: string) => void
  scheduler?: WidgetScheduler
}): BuiltinWidgetApi {
  const api: BuiltinWidgetApi = {
    instanceId: opts.instanceId,
    theme: Object.freeze({ ...opts.theme, vars: Object.freeze({ ...opts.theme.vars }) }),
    space: Object.freeze({ ...opts.space }),
    actions: Object.freeze({ ...opts.actions }),
    openSpace: opts.openSpace,
    ...(opts.scheduler ? { scheduler: Object.freeze({ ...opts.scheduler }) } : {}),
  }
  return Object.freeze(api)
}

export function createMarketplaceWidgetApi(opts: {
  instanceId: string
  theme: WidgetTheme
  space: WidgetSpace
  openSpace: (page?: string) => void
  scheduler?: WidgetScheduler
}): MarketplaceWidgetApi {
  const api: MarketplaceWidgetApi = {
    instanceId: opts.instanceId,
    theme: Object.freeze({ ...opts.theme, vars: Object.freeze({ ...opts.theme.vars }) }),
    space: Object.freeze({ ...opts.space }),
    openSpace: opts.openSpace,
    ...(opts.scheduler ? { scheduler: Object.freeze({ ...opts.scheduler }) } : {}),
  }
  return Object.freeze(api)
}
