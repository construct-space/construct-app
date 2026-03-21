import { describe, expect, it } from 'vitest'
import { buildProjectRoutePath, getProjectRouteKey, slugifyProjectToken } from '../projectRoutes'

describe('slugifyProjectToken', () => {
  it('normalizes mixed text into kebab-case', () => {
    expect(slugifyProjectToken('Laravel Blog CMS')).toBe('laravel-blog-cms')
  })

  it('trims unsupported symbols', () => {
    expect(slugifyProjectToken('  @@ChatAPP__  ')).toBe('chatapp')
  })
})

describe('getProjectRouteKey', () => {
  it('prefers explicit id when present', () => {
    expect(getProjectRouteKey({ id: 'ext-chatapp', name: 'ChatAPP', path: '/tmp/chat' })).toBe('chatapp')
  })

  it('falls back to slugified name', () => {
    expect(getProjectRouteKey({ name: 'Laravel Blog CMS', path: '/tmp/ignored' })).toBe('laravel-blog-cms')
  })

  it('falls back to path segment when name is empty', () => {
    expect(getProjectRouteKey({ name: '', path: '/Users/flakerimi/Desktop/test/Doctor App' })).toBe('doctor-app')
  })

  it('returns stable final fallback', () => {
    expect(getProjectRouteKey({ name: '', path: '' })).toBe('project')
  })
})

describe('buildProjectRoutePath', () => {
  it('builds encoded project single route path', () => {
    expect(buildProjectRoutePath({ id: 'ext-my project' })).toBe('/app/projects/my-project')
  })
})
