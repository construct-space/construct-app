export interface HandoffSnapshot {
  spaceId: string
  sessionId: string
  payload: Record<string, unknown>
}

export interface SpaceHandoffContract {
  stopAndFinalize(sessionId: string): Promise<void>
  save(sessionId: string): Promise<HandoffSnapshot>
  load(snapshot: HandoffSnapshot): Promise<void>
  canDetach?(sessionId: string): boolean
}

export class HandoffNotRegisteredError extends Error {
  constructor(spaceId: string, registered: string[]) {
    super(
      `No handoff contract registered for space '${spaceId}'. ` +
      `Registered: [${registered.join(', ') || '<none>'}]`,
    )
    this.name = 'HandoffNotRegisteredError'
  }
}

const registry = new Map<string, SpaceHandoffContract>()

export function registerHandoff(spaceId: string, contract: SpaceHandoffContract): void {
  registry.set(spaceId, contract)
}

export function getHandoff(spaceId: string): SpaceHandoffContract | null {
  return registry.get(spaceId) ?? null
}

export function hasHandoff(spaceId: string): boolean {
  return registry.has(spaceId)
}

export function registeredSpaces(): string[] {
  return Array.from(registry.keys())
}

export function __resetHandoffRegistry(): void {
  registry.clear()
}
