import { describe, expect, it } from 'vitest'
import { routes } from '../routes'
import {
  SETTINGS_DEFAULT_PATH,
  allSettingsNavItems,
  getSettingsNavGroups,
  settingsRouteChildren,
} from '../settingsNavigation'

function getSettingsRoute() {
  const appRoute = routes.find(route => route.path === '/app')
  return appRoute?.children?.find(route => route.path === 'settings')
}

describe('settings navigation', () => {
  it('keeps settings nav entries and routed pages in sync', () => {
    const navPaths = allSettingsNavItems.map(item => item.path).sort()
    const routedPaths = settingsRouteChildren
      .map(route => `/app/settings/${route.path as string}`)
      .sort()

    expect(navPaths).toEqual(routedPaths)
  })

  it('has no duplicate settings nav routes', () => {
    const navPaths = allSettingsNavItems.map(item => item.path)
    expect(new Set(navPaths).size).toBe(navPaths.length)
  })

  it('redirects /app/settings to the canonical default page', () => {
    const settingsRoute = getSettingsRoute()
    const indexRoute = settingsRoute?.children?.find(child => child.path === '')

    expect(indexRoute?.redirect).toBe(SETTINGS_DEFAULT_PATH)
  })

  it('keeps personal Developer visible in org settings while gating Org Developer by role', () => {
    const memberGroups = getSettingsNavGroups({
      isDeveloper: false,
      isOrg: true,
      isAdmin: false,
      orgRoles: ['member'],
    })
    const memberPaths = memberGroups.flatMap(group => group.items.map(item => item.path))

    expect(memberPaths).toContain('/app/settings/developer')
    expect(memberPaths).not.toContain('/app/settings/org-developer')

    const developerGroups = getSettingsNavGroups({
      isDeveloper: false,
      isOrg: true,
      isAdmin: false,
      orgRoles: ['Developer'],
    })
    const developerPaths = developerGroups.flatMap(group => group.items.map(item => item.path))

    expect(developerPaths).toContain('/app/settings/developer')
    expect(developerPaths).toContain('/app/settings/org-developer')
  })
})
