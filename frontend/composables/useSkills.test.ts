import { beforeEach, describe, expect, it, vi } from 'vitest'

// useSkills now talks to the brain wire (brain.request), not the retired
// operator context-service (start_context_service / send_context_request).
const requestMock = vi.fn()

vi.mock('@/brain', () => ({
  useBrain: () => ({ request: requestMock }),
}))

describe('useSkills', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Object.defineProperty(globalThis, 'window', {
      value: { __TAURI__: {} },
      configurable: true,
      writable: true,
    })
    requestMock.mockImplementation(async (type: string) => {
      if (type === 'skills.save') return { id: 'test-skill', name: 'Test Skill', path: '/tmp/test-skill.md' }
      if (type === 'skills.list') return { skills: [] }
      return {}
    })
  })

  it('saves a skill via the brain wire op', async () => {
    const { useSkills } = await import('./useSkills')
    const skills = useSkills()

    const result = await skills.saveSkill('test-skill.md', '---\nname: test-skill\ndescription: Test\n---\n\nTest')

    expect(result).toEqual({ id: 'test-skill', name: 'Test Skill', path: '/tmp/test-skill.md' })
    expect(requestMock).toHaveBeenCalledWith('skills.save', {
      filename: 'test-skill.md',
      content: expect.any(String),
    })
    // No operator context-service calls anymore.
    expect(requestMock.mock.calls.some(c => c[0] === 'start_context_service')).toBe(false)
  })

  it('lists skills via the brain wire op', async () => {
    const { useSkills } = await import('./useSkills')
    const skills = useSkills()
    await skills.refresh()
    expect(requestMock).toHaveBeenCalledWith('skills.list', {})
  })
})
