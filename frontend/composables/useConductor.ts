/**
 * useConductor — client for the always-on automation control plane.
 *
 * Conductor (conductor.construct.space) owns the user's automation rules and
 * the schedule. Executors (this desktop when it's running, the cloud fallback
 * otherwise) claim due rules and run them. The UI here is a thin CRUD surface
 * over the rules; it does NOT run anything itself — "run now" just marks a rule
 * due so the next polling executor picks it up.
 *
 * Auth: the user's bearer token (Conductor resolves the user via accounts /me).
 * Conductor is its own CORS surface, outside the /api gateway.
 */
import { useApi } from '@/composables/useApi'
import { appConfig } from '@/utils/config'

export interface Automation {
  id: string
  instruction: string
  interval_min: number
  enabled: boolean
  last_run_at?: number
  last_result?: string
  /** set while an executor holds it for a run */
  leased_by?: string
}

export function useConductor() {
  const api = useApi(appConfig.conductorUrl)
  return {
    list: () => api.get<{ automations: Automation[] }>('/api/automations'),
    save: (a: Partial<Automation>) => api.post<Automation>('/api/automations', a),
    remove: (id: string) => api.delete(`/api/automations/${encodeURIComponent(id)}`),
    /** Force a rule due; the next online executor claims it within ~20s. */
    runNow: (id: string) => api.post(`/api/automations/${encodeURIComponent(id)}/run`),
  }
}
