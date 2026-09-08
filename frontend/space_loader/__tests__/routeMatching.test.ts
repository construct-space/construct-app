import { describe, expect, it } from 'vitest'
import { matchRoutePattern, normalizeRoutePattern } from '../routeMatching'

describe('space route matching', () => {
  it('normalizes bracket params to runtime route params', () => {
    expect(normalizeRoutePattern('members/[id]')).toBe('members/:id')
    expect(normalizeRoutePattern('companies/[companyId]/members/[id]')).toBe('companies/:companyId/members/:id')
  })

  it('matches dynamic bundle page keys that use bracket params', () => {
    expect(matchRoutePattern('members/123', 'members/[id]')).toEqual({ id: '123' })
  })
})
