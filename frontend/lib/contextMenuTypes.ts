export type ContextTargetKind = 'space-root' | 'file' | 'folder' | 'document' | 'task' | 'custom'

export interface ContextTargetBase {
  kind: ContextTargetKind
  projectId?: string | number
}

export interface SpaceRootContextTarget extends ContextTargetBase {
  kind: 'space-root'
  spaceId: string
}

export interface FileContextTarget extends ContextTargetBase {
  kind: 'file'
  path: string
  name: string
  extension?: string
}

export interface FolderContextTarget extends ContextTargetBase {
  kind: 'folder'
  path: string
  name: string
}

export interface DocumentContextTarget extends ContextTargetBase {
  kind: 'document'
  id: string
  title: string
}

export interface TaskContextTarget extends ContextTargetBase {
  kind: 'task'
  id: string
  title: string
}

export interface CustomContextTarget extends ContextTargetBase {
  kind: 'custom'
  type: string
  payload: Record<string, unknown>
}

export type ContextTarget =
  | SpaceRootContextTarget
  | FileContextTarget
  | FolderContextTarget
  | DocumentContextTarget
  | TaskContextTarget
  | CustomContextTarget

export interface SpaceLocation {
  spaceId: string
  page?: string
  projectId?: string | number
  query?: Record<string, string | number | boolean>
  state?: Record<string, unknown>
}

export type SpaceNavigationMode = 'push' | 'replace'

export type SpaceContextMenuAction =
  | {
      type: 'host.navigate'
      to: SpaceLocation
      mode?: SpaceNavigationMode
    }
  | {
      type: 'space.open'
      spaceId: string
      page?: string
      mode?: SpaceNavigationMode
      query?: Record<string, string | number | boolean>
    }
  | {
      type: 'space.request'
      spaceId: string
      requestType: string
      params?: Record<string, unknown>
    }

export interface SpaceContextMenuItem {
  id?: string
  label?: string
  icon?: string
  type?: 'item' | 'separator' | 'submenu'
  disabled?: boolean
  shortcut?: string
  children?: SpaceContextMenuItem[]
  action?: SpaceContextMenuAction
  onSelect?: () => void | Promise<unknown>
}

export interface SpaceContextMenuGroup {
  label?: string
  items: SpaceContextMenuItem[]
}

export type SpaceContextMenuGroupsInput =
  | SpaceContextMenuItem[]
  | SpaceContextMenuItem[][]
  | SpaceContextMenuGroup[]

export type SpaceContextMenuConfig = Partial<Record<ContextTargetKind, SpaceContextMenuGroupsInput>>

export interface ContextMenuRequest {
  sourceSpace?: string
  projectId?: string | number
  target: ContextTarget
  items?: SpaceContextMenuGroupsInput
}

export type ContextMenuContributor = (
  request: ContextMenuRequest,
) => SpaceContextMenuGroupsInput | Promise<SpaceContextMenuGroupsInput | undefined> | undefined

export const CONTEXT_TARGET_QUERY_KEY = 'constructTarget'
export const CONTEXT_SOURCE_SPACE_QUERY_KEY = 'constructSourceSpace'

export function normalizeSpaceContextMenuGroups(
  input?: SpaceContextMenuGroupsInput,
): SpaceContextMenuItem[][] {
  if (!input) return []
  if (!Array.isArray(input) || input.length === 0) return []

  const first = input[0]
  if (Array.isArray(first)) {
    return (input as SpaceContextMenuItem[][])
      .map(group => group.filter(Boolean))
      .filter(group => group.length > 0)
  }

  if (isSpaceContextMenuGroup(first)) {
    return (input as SpaceContextMenuGroup[])
      .map(group => group.items.filter(Boolean))
      .filter(group => group.length > 0)
  }

  return [(input as SpaceContextMenuItem[]).filter(Boolean)].filter(group => group.length > 0)
}

export function encodeContextTarget(target: ContextTarget): string {
  return JSON.stringify(target)
}

export function decodeContextTarget(value: unknown): ContextTarget | null {
  if (typeof value !== 'string' || value.length === 0) return null

  try {
    const parsed = JSON.parse(value) as Partial<ContextTarget> | null
    if (!parsed || typeof parsed !== 'object' || typeof parsed.kind !== 'string') return null
    if (!isContextTargetKind(parsed.kind)) return null
    return parsed as ContextTarget
  } catch {
    return null
  }
}

function isSpaceContextMenuGroup(value: unknown): value is SpaceContextMenuGroup {
  return typeof value === 'object' && value !== null && Array.isArray((value as SpaceContextMenuGroup).items)
}

function isContextTargetKind(value: string): value is ContextTargetKind {
  return value === 'space-root'
    || value === 'file'
    || value === 'folder'
    || value === 'document'
    || value === 'task'
    || value === 'custom'
}
