import { describe, expect, it } from 'vitest'
import { useDisplayModels } from './useDisplayModels'

describe('useDisplayModels', () => {
  it('keeps managed catalog models available when live /models omits them', () => {
    const { displayModels, availableCount } = useDisplayModels(
      () => [
        { id: 'GLM-4.7-Flash', label: 'GLM-4.7-Flash' },
        { id: 'glm-5', label: 'GLM-5' },
        { id: 'managed-only-model', label: 'Managed Only' },
      ],
      () => [{ id: 'glm-5', label: 'GLM-5' }],
    )

    expect(displayModels.value.find(m => m.id === 'GLM-4.7-Flash')?.available).toBe(true)
    expect(displayModels.value.find(m => m.id === 'managed-only-model')?.available).toBe(true)
    expect(availableCount.value).toBe(3)
  })

  it('canonicalizes GLM Turbo aliases instead of showing duplicate plan states', () => {
    const { displayModels } = useDisplayModels(
      () => [{ id: 'glm-5v-turbo', label: 'GLM-5V Turbo' }],
      () => [{ id: 'GLM-5-Turbo', label: 'GLM-5-Turbo' }],
    )

    expect(displayModels.value).toEqual([
      expect.objectContaining({
        id: 'GLM-5-Turbo',
        label: 'GLM-5-Turbo',
        available: true,
      }),
    ])
  })

  it('does not append live-only models when source catalog has models', () => {
    const { displayModels } = useDisplayModels(
      () => [
        { id: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro' },
        { id: 'deepseek-v4-flash', label: 'DeepSeek V4 Flash' },
      ],
      () => [
        { id: 'deepseek-chat', label: 'DeepSeek Chat' },
        { id: 'deepseek-reasoner', label: 'DeepSeek Reasoner' },
      ],
    )

    expect(displayModels.value.map(m => m.id)).toEqual([
      'deepseek-v4-pro',
      'deepseek-v4-flash',
    ])
  })
})
