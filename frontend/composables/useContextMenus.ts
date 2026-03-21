import {
  showContextMenu as showNativeContextMenu,
  type NativeMenuOption,
} from '@/composables/useNativeContextMenu'
import { useSpaces } from '@/composables/useSpaces'
import {
  normalizeSpaceContextMenuGroups,
  type ContextMenuContributor,
  type ContextMenuRequest,
  type SpaceContextMenuAction,
  type SpaceContextMenuConfig,
  type SpaceContextMenuItem,
} from '@/lib/contextMenuTypes'
import { openTargetInSpace, navigateToSpace, registerSpaceOpenHandler } from '@/lib/spaceNavigation'
import { requestSpaceData } from '@/lib/spaceContextBus'

const contextMenuContributors = new Map<string, Set<ContextMenuContributor>>()

export function useContextMenus() {
  return {
    openContextMenu,
    registerContextMenuContributor,
    registerSpaceOpenHandler,
    navigateToSpace,
  }
}

export async function openContextMenu(request: ContextMenuRequest): Promise<void> {
  const groups = await resolveContextMenuGroups(request)
  if (groups.length === 0) return

  await showNativeContextMenu(
    groups.map(group => group.map(item => toNativeMenuOption(item, request))),
  )
}

export function registerContextMenuContributor(spaceId: string, contributor: ContextMenuContributor): () => void {
  const contributors = contextMenuContributors.get(spaceId) ?? new Set<ContextMenuContributor>()
  contributors.add(contributor)
  contextMenuContributors.set(spaceId, contributors)

  return () => {
    const current = contextMenuContributors.get(spaceId)
    if (!current) return
    current.delete(contributor)
    if (current.size === 0) {
      contextMenuContributors.delete(spaceId)
    }
  }
}

export async function resolveContextMenuGroups(request: ContextMenuRequest): Promise<SpaceContextMenuItem[][]> {
  const groups: SpaceContextMenuItem[][] = []

  groups.push(...normalizeSpaceContextMenuGroups(request.items))

  const manifestGroups = normalizeSpaceContextMenuGroups(
    (await getSpaceContextMenuConfig(request.sourceSpace))?.[request.target.kind],
  )
  groups.push(...manifestGroups)

  for (const ownerId of ['*', request.sourceSpace].filter(Boolean) as string[]) {
    const contributors = Array.from(contextMenuContributors.get(ownerId) ?? [])
    for (const contributor of contributors) {
      const contributed = await contributor(request)
      groups.push(...normalizeSpaceContextMenuGroups(contributed))
    }
  }

  return groups.filter(group => group.length > 0)
}

async function getSpaceContextMenuConfig(spaceId?: string): Promise<SpaceContextMenuConfig | undefined> {
  if (!spaceId) return undefined

  const { spaces, loadSpaces, getSpace } = useSpaces()
  if (spaces.value.length === 0) {
    await loadSpaces()
  }

  return getSpace(spaceId)?.contextMenus
}

function toNativeMenuOption(
  item: SpaceContextMenuItem,
  request: ContextMenuRequest,
): NativeMenuOption {
  if (item.type === 'separator') {
    return { type: 'separator' as const }
  }

  if (item.children && item.children.length > 0) {
    return {
      label: item.label,
      disabled: item.disabled,
      shortcut: item.shortcut,
      children: item.children.map(child => toNativeMenuOption(child, request)),
    }
  }

  return {
    label: item.label,
    disabled: item.disabled,
    shortcut: item.shortcut,
    onSelect: () => {
      void handleMenuSelect(item, request)
    },
  }
}

async function handleMenuSelect(item: SpaceContextMenuItem, request: ContextMenuRequest): Promise<void> {
  if (item.onSelect) {
    await item.onSelect()
    return
  }

  if (item.action) {
    await executeContextMenuAction(item.action, request)
  }
}

async function executeContextMenuAction(
  action: SpaceContextMenuAction,
  request: ContextMenuRequest,
): Promise<void> {
  switch (action.type) {
    case 'host.navigate':
      await navigateToSpace(action.to, action.mode)
      return
    case 'space.open':
      await openTargetInSpace({
        spaceId: action.spaceId,
        page: action.page,
        projectId: request.projectId ?? request.target.projectId,
        sourceSpace: request.sourceSpace,
        target: request.target,
        query: action.query,
      }, action.mode)
      return
    case 'space.request':
      await requestSpaceData(action.spaceId, {
        type: action.requestType,
        params: {
          ...action.params,
          target: request.target,
          sourceSpace: request.sourceSpace,
        },
      })
  }
}
