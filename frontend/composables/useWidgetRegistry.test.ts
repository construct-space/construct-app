import { beforeEach, describe, expect, it, vi } from 'vitest'
import { setActiveProfileId } from '@/lib/profileStorage'
import { useWidgetRegistry } from './useWidgetRegistry'

const loadedSpacesMock = vi.hoisted(() => new Map<string, { manifest: Record<string, unknown> }>())
const fsMock = vi.hoisted(() => {
  const files = new Map<string, string>()
  const entries: Array<{ name: string; isDirectory: boolean }> = []
  return {
    files,
    entries,
    exists: vi.fn(async (path: string) => path === '/home/Construct/spaces' || files.has(path)),
    readDir: vi.fn(async () => entries),
    readTextFile: vi.fn(async (path: string) => {
      const value = files.get(path)
      if (value === undefined) throw new Error(`Missing test file: ${path}`)
      return value
    }),
  }
})

const localStorageMock = vi.hoisted(() => {
  const store = new Map<string, string>()
  const api = {
    get length() { return store.size },
    clear: vi.fn(() => store.clear()),
    getItem: vi.fn((key: string) => store.get(key) ?? null),
    key: vi.fn((index: number) => Array.from(store.keys())[index] ?? null),
    removeItem: vi.fn((key: string) => { store.delete(key) }),
    setItem: vi.fn((key: string, value: string) => { store.set(key, value) }),
  }
  Object.defineProperty(globalThis, 'localStorage', {
    value: api,
    configurable: true,
  })
  return api
})

vi.mock('@/space_loader/builtin', () => ({
  BUILTIN_SPACE_IDS: [],
}))

vi.mock('@/space_loader/coreSpaces', () => ({
  DEVELOPER_ONLY_SPACES: new Set<string>(),
  getCoreSpaceManifests: () => [],
}))

vi.mock('@/composables/useDevMode', () => ({
  useDevMode: () => ({ isEnrolled: { value: false } }),
}))

vi.mock('@/space_loader/SpaceLoader', () => ({
  getLoadedSpaces: () => loadedSpacesMock,
  loadSpace: vi.fn(async () => null),
}))

vi.mock('@tauri-apps/api/path', () => ({
  homeDir: vi.fn(async () => '/home'),
}))

vi.mock('@tauri-apps/plugin-fs', () => ({
  exists: fsMock.exists,
  readDir: fsMock.readDir,
  readTextFile: fsMock.readTextFile,
}))

describe('useWidgetRegistry', () => {
  beforeEach(() => {
    localStorageMock.clear()
    loadedSpacesMock.clear()
    fsMock.files.clear()
    fsMock.entries.length = 0
    fsMock.exists.mockClear()
    fsMock.readDir.mockClear()
    fsMock.readTextFile.mockClear()
    setActiveProfileId('profile-a')
  })

  it('resets the in-memory home layout when the active profile has no saved layout', async () => {
    const registry = useWidgetRegistry()
    const storedLayout = {
      version: 1,
      items: [{
        instanceId: 'weather-1',
        spaceId: 'weather',
        widgetId: 'summary',
        sizeKey: '2x1',
        x: 0,
        y: 0,
        w: 2,
        h: 1,
      }],
    }

    localStorage.setItem('profile-a:construct:home_layout', JSON.stringify(storedLayout))

    await registry.loadLayout()
    expect(registry.layout.value.items).toHaveLength(1)

    setActiveProfileId('profile-b')
    await registry.loadLayout()

    expect(registry.layout.value.items).toEqual([])
  })

  it('refreshes catalog widgets from disk when a loaded space manifest is stale', async () => {
    loadedSpacesMock.set('radio', {
      manifest: {
        id: 'radio',
        widgets: [{
          id: 'summary',
          name: 'Old Radio',
          defaultSize: '2x1',
          sizes: { '2x1': 'widgets/summary/2x1.vue' },
        }],
      },
    })
    fsMock.entries.push({ name: 'radio.space', isDirectory: true })
    fsMock.files.set('/home/Construct/spaces/radio.space/manifest.json', JSON.stringify({
      id: 'radio',
      widgets: [{
        id: 'summary',
        name: 'Radio',
        description: 'Now playing station',
        defaultSize: '4x1',
        sizes: {
          '2x1': 'widgets/summary/2x1.vue',
          '4x1': 'widgets/summary/4x1.vue',
        },
      }],
    }))

    const registry = useWidgetRegistry()
    await registry.loadCatalog()

    expect(registry.catalog.value).toEqual([expect.objectContaining({
      id: 'summary',
      spaceId: 'radio',
      name: 'Radio',
      description: 'Now playing station',
      defaultSize: '4x1',
      sizes: ['2x1', '4x1'],
    })])
  })
})
