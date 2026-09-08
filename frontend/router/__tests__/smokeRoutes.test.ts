import { describe, expect, it } from 'vitest'
import { routes } from '../routes'
import type { RouteRecordRaw } from 'vue-router'

function getAppRoute(): RouteRecordRaw | undefined {
  return routes.find(route => route.path === '/app')
}

function findChild(parent: RouteRecordRaw | undefined, path: string): RouteRecordRaw | undefined {
  return parent?.children?.find(child => child.path === path)
}

describe('smoke: app-space routing', () => {
  it('/app route exists with requiresAuth meta', () => {
    const appRoute = getAppRoute()
    expect(appRoute).toBeDefined()
    expect(appRoute?.meta?.requiresAuth).toBe(true)
  })

  it('/app has home route at empty path', () => {
    const appRoute = getAppRoute()
    const home = findChild(appRoute, '')
    expect(home).toBeDefined()
    expect(home?.name).toBe('home')
  })

  it('/app has spaces route', () => {
    const appRoute = getAppRoute()
    const spaces = findChild(appRoute, 'spaces')
    expect(spaces).toBeDefined()
    expect(spaces?.name).toBe('spaces')
  })

  it('/app has marketplace route', () => {
    const appRoute = getAppRoute()
    const marketplace = findChild(appRoute, 'marketplace')
    expect(marketplace).toBeDefined()
    expect(marketplace?.name).toBe('marketplace')
  })

  it('/app has settings route with children', () => {
    const appRoute = getAppRoute()
    const settings = findChild(appRoute, 'settings')
    expect(settings).toBeDefined()
    expect(settings?.children).toBeDefined()
    expect(settings!.children!.length).toBeGreaterThan(0)
  })
})

describe('smoke: project-space routing', () => {
  it('/app/projects route exists', () => {
    const appRoute = getAppRoute()
    const projects = findChild(appRoute, 'projects')
    expect(projects).toBeDefined()
    expect(projects?.name).toBe('projects')
  })

  it('/app/projects/:projectId route exists with projectScoped meta', () => {
    const appRoute = getAppRoute()
    const projectDetail = findChild(appRoute, 'projects/:projectId')
    expect(projectDetail).toBeDefined()
    expect(projectDetail?.meta?.projectScoped).toBe(true)
  })

  it('/app/projects/:projectId has project-detail child', () => {
    const appRoute = getAppRoute()
    const projectLayout = findChild(appRoute, 'projects/:projectId')
    const detail = findChild(projectLayout, '')
    expect(detail).toBeDefined()
    expect(detail?.name).toBe('project-detail')
  })

  it('/app/projects/:projectId/builder route exists', () => {
    const appRoute = getAppRoute()
    const projectLayout = findChild(appRoute, 'projects/:projectId')
    const builder = findChild(projectLayout, 'builder')
    expect(builder).toBeDefined()
    expect(builder?.name).toBe('project-builder')
  })

  it('/app/projects/:projectId/space-developer route exists', () => {
    const appRoute = getAppRoute()
    const projectLayout = findChild(appRoute, 'projects/:projectId')
    const spaceDeveloper = findChild(projectLayout, 'space-developer')
    expect(spaceDeveloper).toBeDefined()
    expect(spaceDeveloper?.name).toBe('project-space-developer')
  })

  it('/app/projects/:projectId/:spaceName dynamic route exists', () => {
    const appRoute = getAppRoute()
    const projectLayout = findChild(appRoute, 'projects/:projectId')
    const dynamicSpace = findChild(projectLayout, ':spaceName')
    expect(dynamicSpace).toBeDefined()
    expect(dynamicSpace?.children).toBeDefined()
  })
})

describe('smoke: sidebar/pinned space behavior', () => {
  it('core app-level space routes exist (ask, builder, space-developer, editor)', () => {
    const appRoute = getAppRoute()

    const ask = findChild(appRoute, 'ask')
    expect(ask).toBeDefined()
    expect(ask?.name).toBe('ask')

    const builder = findChild(appRoute, 'builder')
    expect(builder).toBeDefined()
    expect(builder?.name).toBe('builder')

    const spaceDeveloper = findChild(appRoute, 'space-developer')
    expect(spaceDeveloper).toBeDefined()
    expect(spaceDeveloper?.name).toBe('space-developer')
  })

  it('dynamic space catch-all route exists at app level', () => {
    const appRoute = getAppRoute()
    const dynamicSpace = findChild(appRoute, ':spaceName')
    expect(dynamicSpace).toBeDefined()
    expect(dynamicSpace?.children).toBeDefined()
    expect(dynamicSpace!.children!.length).toBeGreaterThan(0)
  })
})

describe('smoke: builder / space-developer cross-scope availability', () => {
  it('builder route is accessible at both app and project level', () => {
    const appRoute = getAppRoute()
    const appBuilder = findChild(appRoute, 'builder')
    expect(appBuilder).toBeDefined()

    const projectLayout = findChild(appRoute, 'projects/:projectId')
    const projBuilder = findChild(projectLayout, 'builder')
    expect(projBuilder).toBeDefined()
  })

  it('space-developer route is accessible at both app and project level', () => {
    const appRoute = getAppRoute()
    const appSpaceDev = findChild(appRoute, 'space-developer')
    expect(appSpaceDev).toBeDefined()

    const projectLayout = findChild(appRoute, 'projects/:projectId')
    const projSpaceDev = findChild(projectLayout, 'space-developer')
    expect(projSpaceDev).toBeDefined()
  })

  it('catch-all route redirects to /app', () => {
    const catchAll = routes.find(route => route.path === '/:pathMatch(.*)*')
    expect(catchAll).toBeDefined()
    expect(catchAll?.redirect).toBe('/app')
  })

  it('root / redirects to /app', () => {
    const root = routes.find(route => route.path === '/')
    expect(root).toBeDefined()
    expect(root?.redirect).toBe('/app')
  })
})
