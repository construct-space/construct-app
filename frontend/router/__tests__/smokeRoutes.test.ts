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

  it('/app/projects/:projectId/architect route exists', () => {
    const appRoute = getAppRoute()
    const projectLayout = findChild(appRoute, 'projects/:projectId')
    const architect = findChild(projectLayout, 'architect')
    expect(architect).toBeDefined()
    expect(architect?.name).toBe('project-architect')
  })

  it('/app/projects/:projectId/coder route exists', () => {
    const appRoute = getAppRoute()
    const projectLayout = findChild(appRoute, 'projects/:projectId')
    const coder = findChild(projectLayout, 'coder')
    expect(coder).toBeDefined()
    expect(coder?.name).toBe('project-coder')
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
  it('core spaces (brainstorm, architect, coder) have app-level routes', () => {
    const appRoute = getAppRoute()

    const brainstorm = findChild(appRoute, 'brainstorm')
    expect(brainstorm).toBeDefined()
    expect(brainstorm?.name).toBe('brainstorm')

    const architect = findChild(appRoute, 'architect')
    expect(architect).toBeDefined()
    expect(architect?.name).toBe('architect')

    const coder = findChild(appRoute, 'coder')
    expect(coder).toBeDefined()
    expect(coder?.name).toBe('coder')
  })

  it('dynamic space catch-all route exists at app level', () => {
    const appRoute = getAppRoute()
    const dynamicSpace = findChild(appRoute, ':spaceName')
    expect(dynamicSpace).toBeDefined()
    expect(dynamicSpace?.children).toBeDefined()
    expect(dynamicSpace!.children!.length).toBeGreaterThan(0)
  })
})

describe('smoke: architect -> docs -> coder handoff flow', () => {
  it('architect route is accessible at both app and project level', () => {
    const appRoute = getAppRoute()

    // App-level architect
    const appArchitect = findChild(appRoute, 'architect')
    expect(appArchitect).toBeDefined()

    // Project-level architect
    const projectLayout = findChild(appRoute, 'projects/:projectId')
    const projArchitect = findChild(projectLayout, 'architect')
    expect(projArchitect).toBeDefined()
  })

  it('coder route is accessible at both app and project level', () => {
    const appRoute = getAppRoute()

    // App-level coder
    const appCoder = findChild(appRoute, 'coder')
    expect(appCoder).toBeDefined()

    // Project-level coder
    const projectLayout = findChild(appRoute, 'projects/:projectId')
    const projCoder = findChild(projectLayout, 'coder')
    expect(projCoder).toBeDefined()
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
