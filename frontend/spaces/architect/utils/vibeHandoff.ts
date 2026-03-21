import type { ArchitectPlan } from './documentsGenerator'

export interface VibeHandoffDecision {
  id: string
  label: string
  value: string | string[]
}

export interface VibeHandoff {
  id: string
  source: 'architect' | 'project' | 'dashboard' | 'manual'
  description: string
  plan?: ArchitectPlan | null
  decisions?: VibeHandoffDecision[]
  projectId?: string
  createdAt: string
}

const VIBE_HANDOFF_PREFIX = 'construct:vibe:handoff:'
export const PROJECT_VIBE_HANDOFF_RELATIVE_PATH = '.construct/architect-handoff.json'

export function createVibeHandoff(input: Omit<VibeHandoff, 'id' | 'createdAt'>): VibeHandoff {
  return {
    ...input,
    id: `vibe-handoff-${Date.now()}`,
    createdAt: new Date().toISOString(),
  }
}

export function storeVibeHandoff(input: Omit<VibeHandoff, 'id' | 'createdAt'>): string {
  const handoff = createVibeHandoff(input)

  if (typeof window !== 'undefined' && window.sessionStorage) {
    window.sessionStorage.setItem(VIBE_HANDOFF_PREFIX + handoff.id, JSON.stringify(handoff))
  }

  return handoff.id
}

export async function saveProjectVibeHandoff(
  projectPath: string,
  input: Omit<VibeHandoff, 'id' | 'createdAt'>,
): Promise<VibeHandoff | null> {
  if (!projectPath.trim()) return null

  const handoff = createVibeHandoff(input)
  try {
    const tauriFs = await import('@tauri-apps/plugin-fs')
    const constructDir = `${projectPath}/.construct`
    const handoffPath = `${projectPath}/${PROJECT_VIBE_HANDOFF_RELATIVE_PATH}`
    const exists = await tauriFs.exists(constructDir)
    if (!exists) {
      await tauriFs.mkdir(constructDir, { recursive: true })
    }
    await tauriFs.writeTextFile(handoffPath, JSON.stringify(handoff, null, 2))
    return handoff
  } catch {
    return null
  }
}

export async function loadProjectVibeHandoff(projectPath: string): Promise<VibeHandoff | null> {
  if (!projectPath.trim()) return null

  try {
    const tauriFs = await import('@tauri-apps/plugin-fs')
    const handoffPath = `${projectPath}/${PROJECT_VIBE_HANDOFF_RELATIVE_PATH}`
    const exists = await tauriFs.exists(handoffPath)
    if (!exists) return null
    const raw = await tauriFs.readTextFile(handoffPath)
    return JSON.parse(raw) as VibeHandoff
  } catch {
    return null
  }
}

export function loadVibeHandoff(id: string | null | undefined): VibeHandoff | null {
  if (!id || typeof window === 'undefined' || !window.sessionStorage) return null

  const raw = window.sessionStorage.getItem(VIBE_HANDOFF_PREFIX + id)
  if (!raw) return null

  try {
    return JSON.parse(raw) as VibeHandoff
  } catch {
    return null
  }
}

export function summarizeVibeHandoff(handoff: VibeHandoff | null): string {
  if (!handoff) return ''

  const lines: string[] = []
  lines.push(`Vibe handoff source: ${handoff.source}`)
  lines.push(`Project brief: ${handoff.description}`)

  if (handoff.plan?.name) {
    lines.push(`Planned project: ${handoff.plan.name}`)
  }
  if (handoff.plan?.description) {
    lines.push(`Plan summary: ${handoff.plan.description}`)
  }
  const prd = handoff.plan?.docs?.prd || handoff.plan?.prd
  if (prd?.coreFeatures?.length) {
    lines.push(`Core features: ${prd.coreFeatures.slice(0, 8).join(', ')}`)
  }
  if (prd?.mvpScope?.length) {
    lines.push(`MVP scope: ${prd.mvpScope.slice(0, 8).join(', ')}`)
  }
  if (handoff.decisions?.length) {
    lines.push('Decisions:')
    for (const decision of handoff.decisions.slice(0, 12)) {
      const value = Array.isArray(decision.value) ? decision.value.join(', ') : decision.value
      lines.push(`- ${decision.label}: ${value}`)
    }
  }

  return lines.join('\n')
}

export function deriveVibeGoal(handoff: VibeHandoff | null, fallbackGoal = ''): string {
  if (handoff?.plan?.name) return `Build ${handoff.plan.name}`
  if (handoff?.description?.trim()) return handoff.description.trim()
  return fallbackGoal.trim()
}
