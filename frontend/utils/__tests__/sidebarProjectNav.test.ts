import { describe, expect, it } from 'vitest'
import {
  buildProjectSpaceSubItems,
  isProjectRoutePath,
  parseProjectRouteContext,
} from '../sidebarProjectNav'
import { routeParamString } from '../projectRoutes'

describe('routeParamString', () => {
  it('reads string and array params safely', () => {
    expect(routeParamString('abc')).toBe('abc')
    expect(routeParamString(['first', 'second'])).toBe('first')
    expect(routeParamString(undefined)).toBe('')
  })
})

describe('parseProjectRouteContext', () => {
  it('returns context for valid project route params', () => {
    const context = parseProjectRouteContext({
      projectId: 'laravel-blog-cms',
      spaceName: 'code',
      subPage: 'editor',
    })
    expect(context).toEqual({
      projectId: 'laravel-blog-cms',
      spaceName: 'code',
      subPage: 'editor',
    })
  })

  it('returns null when project scope params are incomplete', () => {
    expect(parseProjectRouteContext({ projectId: 'abc' })).toBeNull()
    expect(parseProjectRouteContext({ spaceName: 'code' })).toBeNull()
  })
})

describe('buildProjectSpaceSubItems', () => {
  const spaces = [
    {
      name: 'code',
      pages: [
        { path: '', label: 'Overview', icon: 'i-lucide-home' },
        { path: 'editor', label: 'Editor', icon: 'i-lucide-code' },
        { path: 'terminal', label: 'Terminal', icon: 'i-lucide-terminal' },
        { path: 'editor', label: 'Editor Duplicate', icon: 'i-lucide-code' },
      ],
    },
  ]

  it('builds only subpage routes for the active space', () => {
    const items = buildProjectSpaceSubItems(spaces, {
      projectId: 'chatapp',
      spaceName: 'code',
      subPage: '',
    })

    expect(items).toEqual([
      {
        id: 'editor',
        label: 'Editor',
        icon: 'i-lucide-code',
        route: '/app/projects/chatapp/code/editor',
      },
      {
        id: 'terminal',
        label: 'Terminal',
        icon: 'i-lucide-terminal',
        route: '/app/projects/chatapp/code/terminal',
      },
    ])
  })

  it('returns empty list when no matching space/context', () => {
    expect(buildProjectSpaceSubItems(spaces, null)).toEqual([])
    expect(buildProjectSpaceSubItems(spaces, {
      projectId: 'chatapp',
      spaceName: 'docs',
      subPage: '',
    })).toEqual([])
  })
})

describe('isProjectRoutePath', () => {
  it('recognizes project root and sub-routes', () => {
    expect(isProjectRoutePath('/app/projects/chatapp')).toBe(true)
    expect(isProjectRoutePath('/app/projects/chatapp/code')).toBe(true)
    expect(isProjectRoutePath('/app/projects/chatapp/code/editor')).toBe(true)
  })

  it('rejects non-project routes', () => {
    expect(isProjectRoutePath('/app')).toBe(false)
    expect(isProjectRoutePath('/app/code/editor')).toBe(false)
    expect(isProjectRoutePath('/login')).toBe(false)
  })
})
