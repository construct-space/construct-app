import { describe, it, expect, vi, afterEach } from 'vitest'
import { useHttp } from './useHttp'

// jsdom has no __TAURI_INTERNALS__, so useHttp falls back to the browser-fetch
// transport — we mock global fetch to observe what the client sends.

function mockFetch(impl: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  const fn = vi.fn(impl)
  vi.stubGlobal('fetch', fn)
  return fn
}

afterEach(() => vi.unstubAllGlobals())

describe('useHttp client', () => {
  it('get() returns the parsed JSON body directly', async () => {
    mockFetch(() => new Response(JSON.stringify({ temp: 21 }), { status: 200 }))
    const data = await useHttp().get<{ temp: number }>('https://api.test/forecast')
    expect(data).toEqual({ temp: 21 })
  })

  it('serializes params (arrays repeat, null/undefined skipped)', async () => {
    const fetchFn = mockFetch(() => new Response('{}', { status: 200 }))
    await useHttp().get('https://api.test/x', {
      params: { lat: 41.3, kinds: ['a', 'b'], skip: null, gone: undefined },
    })
    const calledUrl = fetchFn.mock.calls[0][0] as string
    expect(calledUrl).toContain('lat=41.3')
    expect(calledUrl).toContain('kinds=a&kinds=b')
    expect(calledUrl).not.toContain('skip')
    expect(calledUrl).not.toContain('gone')
  })

  it('throws an HttpError on non-2xx by default', async () => {
    mockFetch(() => new Response('nope', { status: 404 }))
    const http = useHttp()
    await expect(http.get('https://api.test/missing')).rejects.toMatchObject({ status: 404 })
    try {
      await http.get('https://api.test/missing')
    } catch (e) {
      expect(http.isHttpError(e)).toBe(true)
    }
  })

  it('post() JSON-encodes a plain object body', async () => {
    const fetchFn = mockFetch(() => new Response('{"ok":true}', { status: 200 }))
    await useHttp().post('https://api.test/save', { name: 'x' })
    const init = fetchFn.mock.calls[0][1] as RequestInit
    expect(init.method).toBe('POST')
    expect(init.body).toBe('{"name":"x"}')
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json')
  })
})
