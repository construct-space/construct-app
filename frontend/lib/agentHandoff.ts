/**
 * Agent handoff — when an agent detects an out-of-scope request, it emits a
 * trailing `<<handoff:<agent-id>>>` marker. The frontend strips the marker
 * and renders a "Switch to X" button that carries the user's original prompt
 * over via a `?q=` query param. The target page reads `q` on mount and
 * auto-sends it, so the user doesn't have to retype.
 */
import { navigateToSpace } from './spaceNavigation'

export type HandoffTarget = 'builder' | 'space-developer'

const HANDOFF_LABELS: Record<HandoffTarget, string> = {
  'builder': 'Builder',
  'space-developer': 'Space Developer',
}

const HANDOFF_MARKER_RE = /<<\s*handoff\s*:\s*(builder|space-developer)\s*>>/i

export interface ParsedHandoff {
  /** Target agent the source agent wants to route to. */
  target: HandoffTarget
  /** Response text with the marker removed. */
  cleanText: string
}

export function parseHandoff(text: string): ParsedHandoff | null {
  if (!text) return null
  const match = text.match(HANDOFF_MARKER_RE)
  if (!match) return null
  const target = match[1].toLowerCase() as HandoffTarget
  const cleanText = text.replace(HANDOFF_MARKER_RE, '').trimEnd()
  return { target, cleanText }
}

export function handoffLabel(target: HandoffTarget): string {
  return HANDOFF_LABELS[target] ?? target
}

/**
 * Navigate to the handoff target. If a projectId is supplied we go through
 * the project-scoped route (e.g. `/app/projects/<id>/space-developer`);
 * otherwise the app-level route (e.g. `/app/space-developer`), which lets the
 * user pick or create a project when they land there.
 *
 * The `prompt` is passed as `?q=` so the destination page can auto-send it.
 */
export async function performHandoff(
  target: HandoffTarget,
  opts: { projectId?: string; prompt?: string } = {},
): Promise<void> {
  await navigateToSpace({
    spaceId: target,
    projectId: opts.projectId,
    query: opts.prompt ? { q: opts.prompt } : undefined,
  })
}
