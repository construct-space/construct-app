import { beforeEach, describe, expect, it, vi } from 'vitest'

const listModelsMock = vi.fn()

vi.mock('@/brain', () => ({
  useBrain: () => ({
    listModels: listModelsMock,
  }),
}))

const remoteCatalog = {
  version: 'v-test',
  data: [
    {
      id: 'anthropic',
      slug: 'anthropic',
      name: 'Anthropic',
      auth_type: 'api_key',
      has_shared_key: false,
      api_key: { enabled: true, base_url: 'https://api.anthropic.com' },
      models: [{ id: 'claude-test', name: 'Claude Test' }],
    },
  ],
}

describe('useProviderCatalog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    listModelsMock.mockResolvedValue(remoteCatalog)
  })

  it('loads providers via brain.listModels', async () => {
    const { useProviderCatalog } = await import('./useProviderCatalog')
    const catalog = useProviderCatalog()
    await catalog.load(true)

    expect(listModelsMock).toHaveBeenCalledTimes(1)
    expect(catalog.catalog.value).toHaveLength(1)
    expect(catalog.catalog.value[0].id).toBe('anthropic')
    expect(catalog.catalogVersion.value).toBe('v-test')
  })

  it('tolerates the "providers" wrapper shape as well as "data"', async () => {
    listModelsMock.mockResolvedValueOnce({
      version: 'v-test',
      providers: remoteCatalog.data,
    })
    const { useProviderCatalog } = await import('./useProviderCatalog')
    const catalog = useProviderCatalog()
    await catalog.load(true)

    expect(catalog.catalog.value).toHaveLength(1)
  })

  it('keeps prior catalog when brain is unreachable', async () => {
    const { useProviderCatalog } = await import('./useProviderCatalog')
    const catalog = useProviderCatalog()
    await catalog.load(true)
    const before = catalog.catalog.value

    listModelsMock.mockRejectedValueOnce(new Error('brain down'))
    await catalog.load(true)

    expect(catalog.catalog.value).toEqual(before)
  })
})
