import { describe, expect, it } from 'vitest'

import {
  buildSpaceOpenLocation,
  resolveSpacePath,
} from '../spaceNavigation'
import {
  CONTEXT_SOURCE_SPACE_QUERY_KEY,
  CONTEXT_TARGET_QUERY_KEY,
  decodeContextTarget,
  normalizeSpaceContextMenuGroups,
} from '../contextMenuTypes'

describe('context menu helpers', () => {
  it('normalizes flat item arrays into a single group', () => {
    const groups = normalizeSpaceContextMenuGroups([
      { id: 'open', label: 'Open' },
      { id: 'rename', label: 'Rename' },
    ])

    expect(groups).toHaveLength(1)
    expect(groups[0]).toHaveLength(2)
  })

  it('normalizes group objects', () => {
    const groups = normalizeSpaceContextMenuGroups([
      { items: [{ id: 'open', label: 'Open' }] },
      { items: [{ id: 'rename', label: 'Rename' }] },
    ])

    expect(groups).toHaveLength(2)
    expect(groups[1][0]?.label).toBe('Rename')
  })
})

describe('space navigation helpers', () => {
  it('builds app and project space paths', () => {
    expect(resolveSpacePath({ spaceId: 'docs' })).toBe('/app/docs')
    expect(resolveSpacePath({ spaceId: 'code', page: 'editor', projectId: 42 })).toBe('/app/projects/42/code/editor')
  })

  it('serializes context targets into the open location query', () => {
    const location = buildSpaceOpenLocation({
      spaceId: 'code',
      page: 'editor',
      projectId: 7,
      sourceSpace: 'docs',
      target: {
        kind: 'file',
        path: '/tmp/readme.md',
        name: 'readme.md',
        projectId: 7,
      },
    })

    expect(location.query?.[CONTEXT_SOURCE_SPACE_QUERY_KEY]).toBe('docs')
    const target = decodeContextTarget(location.query?.[CONTEXT_TARGET_QUERY_KEY])
    expect(target).toMatchObject({
      kind: 'file',
      path: '/tmp/readme.md',
      name: 'readme.md',
      projectId: 7,
    })
  })
})
