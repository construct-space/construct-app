import { describe, expect, it } from 'vitest'
import { buildProjectRoutePath, getProjectRouteKey } from '../projectRoutes'
import {
  buildProjectSpaceSubItems,
  parseProjectRouteContext,
} from '../sidebarProjectNav'

describe('project navigation integration', () => {
  it('connects recent-project route key with project space subpages', () => {
    const project = {
      name: 'Laravel Blog CMS',
      path: '/Users/flakerimi/Desktop/test/Laravel Blog CMS',
    }

    const projectKey = getProjectRouteKey(project)
    const projectRoute = buildProjectRoutePath(project)

    expect(projectKey).toBe('laravel-blog-cms')
    expect(projectRoute).toBe('/app/projects/laravel-blog-cms')

    const context = parseProjectRouteContext({
      projectId: projectKey,
      spaceName: 'code',
      subPage: '',
    })

    const subItems = buildProjectSpaceSubItems(
      [
        {
          name: 'code',
          pages: [
            { path: '', label: 'Overview' },
            { path: 'editor', label: 'Editor' },
            { path: 'terminal', label: 'Terminal' },
          ],
        },
      ],
      context,
    )

    expect(subItems.map(item => item.route)).toEqual([
      '/app/projects/laravel-blog-cms/code/editor',
      '/app/projects/laravel-blog-cms/code/terminal',
    ])
  })
})
