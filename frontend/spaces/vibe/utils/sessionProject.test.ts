import { describe, expect, it } from 'vitest'
import { getVibeSessionProjectKey, sameVibeSessionProject } from './sessionProject'

describe('sessionProject', () => {
  it('does not merge different projects that share the same display name', () => {
    const first = { id: 's1', project_id: 'alpha', project_name: 'Website' }
    const second = { id: 's2', project_id: 'beta', project_name: 'Website' }

    expect(getVibeSessionProjectKey(first)).not.toBe(getVibeSessionProjectKey(second))
    expect(sameVibeSessionProject(first, second)).toBe(false)
  })

  it('matches sessions by normalized project path when ids are unavailable', () => {
    const first = { id: 's1', project_path: '/tmp/demo/' }
    const second = { id: 's2', project_path: '/tmp/demo' }

    expect(sameVibeSessionProject(first, second)).toBe(true)
  })

  it('falls back to the session id when only the project name is known', () => {
    const first = { id: 's1', project_name: 'Website' }
    const second = { id: 's2', project_name: 'Website' }

    expect(getVibeSessionProjectKey(first)).not.toBe(getVibeSessionProjectKey(second))
  })
})
