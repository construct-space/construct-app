/**
 * useHttp — the HTTP client exposed to spaces via `@construct-space/sdk`.
 *
 * Spaces must not bring their own axios/ky/ofetch — they call `useHttp()` and
 * get a full axios-like client. Requests route through the host's `http_fetch`
 * Tauri command (reqwest) so cross-origin calls bypass the webview's CORS
 * rules; on web/test it falls back to native `fetch`.
 *
 * This is the host-side implementation of the published SDK `HttpClient`
 * contract: verb shortcuts that return parsed bodies, `request()` for the full
 * response, query `params`, retries with backoff, interceptors, `create()` for
 * scoped clients, and `isHttpError()`.
 *
 * Example:
 *   const http = useHttp()
 *   const data = await http.get<Forecast>(url, { params: { lat, lon }, retries: 3 })
 */
import { invoke } from '@tauri-apps/api/core'
import { isTauriEnv } from '@/utils/tauri'

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS'

export interface HttpRequestConfig {
  method?: HttpMethod
  url?: string
  /** Query params. Arrays repeat the key; null/undefined are skipped. */
  params?: Record<string, string | number | boolean | null | undefined | Array<string | number>>
  headers?: Record<string, string>
  /** Body. Plain objects → JSON; string/Uint8Array/Blob/FormData passed through. */
  data?: unknown
  timeoutMs?: number
  responseType?: 'json' | 'text' | 'bytes' | 'blob'
  signal?: AbortSignal
  /** Retry count (0 disables). Idempotent methods retry on 5xx/network errors. */
  retries?: number
  shouldRetry?(err: HttpError, attempt: number): boolean
  /** When true (default) non-2xx throws HttpError. */
  throwOnError?: boolean
}

export interface HttpResponse<T = unknown> {
  data: T
  status: number
  statusText: string
  headers: Record<string, string>
  url: string
}

export interface HttpError extends Error {
  status?: number
  statusText?: string
  data?: unknown
  headers?: Record<string, string>
  url?: string
  config?: HttpRequestConfig
  cancelled?: boolean
  isNetworkError?: boolean
}

export interface HttpClientDefaults {
  baseUrl?: string
  headers?: Record<string, string>
  timeoutMs?: number
  retries?: number
  responseType?: HttpRequestConfig['responseType']
}

export interface HttpInterceptors {
  request: {
    use(fn: (config: HttpRequestConfig) => HttpRequestConfig | Promise<HttpRequestConfig>): number
    eject(id: number): void
  }
  response: {
    use(
      onFulfilled?: (res: HttpResponse) => HttpResponse | Promise<HttpResponse>,
      onRejected?: (err: HttpError) => unknown,
    ): number
    eject(id: number): void
  }
}

export interface HttpClient {
  get<T = unknown>(url: string, config?: HttpRequestConfig): Promise<T>
  delete<T = unknown>(url: string, config?: HttpRequestConfig): Promise<T>
  head<T = unknown>(url: string, config?: HttpRequestConfig): Promise<T>
  options<T = unknown>(url: string, config?: HttpRequestConfig): Promise<T>
  post<T = unknown>(url: string, data?: unknown, config?: HttpRequestConfig): Promise<T>
  put<T = unknown>(url: string, data?: unknown, config?: HttpRequestConfig): Promise<T>
  patch<T = unknown>(url: string, data?: unknown, config?: HttpRequestConfig): Promise<T>
  request<T = unknown>(config: HttpRequestConfig): Promise<HttpResponse<T>>
  create(defaults?: HttpClientDefaults): HttpClient
  defaults: HttpClientDefaults
  interceptors: HttpInterceptors
  isHttpError(err: unknown): err is HttpError
  /** Low-level escape hatch (host extension, not part of the SDK contract). */
  fetch(url: string, init?: HttpFetchInit): Promise<HttpFetchResponse>
}

// ── Low-level fetch (kept for the .fetch escape hatch + as the transport) ──

export interface HttpFetchInit {
  method?: string
  headers?: Record<string, string>
  body?: string
  bodyBytes?: Uint8Array
  responseType?: 'text' | 'bytes'
  timeoutMs?: number
  signal?: AbortSignal
}

export interface HttpFetchResponse {
  status: number
  ok: boolean
  headers: Record<string, string>
  body: string
  bodyBytes?: Uint8Array
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk) as unknown as number[])
  }
  return btoa(binary)
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64)
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
  return out
}

async function rawFetch(url: string, init: HttpFetchInit = {}): Promise<HttpFetchResponse> {
  if (init.signal?.aborted) throw new DOMException('Aborted', 'AbortError')

  if (!isTauriEnv()) {
    const browserBody: BodyInit | undefined = init.bodyBytes
      ? new Blob([init.bodyBytes as unknown as ArrayBuffer])
      : init.body
    const r = await fetch(url, {
      method: init.method,
      headers: init.headers,
      body: browserBody,
      signal: init.signal,
    })
    const headers = Object.fromEntries(r.headers.entries())
    if (init.responseType === 'bytes') {
      const buf = await r.arrayBuffer()
      return { status: r.status, ok: r.ok, headers, body: '', bodyBytes: new Uint8Array(buf) }
    }
    return { status: r.status, ok: r.ok, headers, body: await r.text() }
  }

  const bodyB64 = init.bodyBytes ? bytesToBase64(init.bodyBytes) : undefined
  const raw = await invoke<{
    status: number
    ok: boolean
    headers: Record<string, string>
    body: string
    body_b64?: string
  }>('http_fetch', {
    args: {
      url,
      method: init.method,
      headers: init.headers,
      body: bodyB64 ? undefined : init.body,
      body_b64: bodyB64,
      response_type: init.responseType === 'bytes' ? 'bytes' : undefined,
      timeout_ms: init.timeoutMs,
    },
  })
  // The Tauri command runs in Rust and can't observe a JS AbortSignal mid-flight;
  // honor cancellation at the boundary so abort still rejects predictably.
  if (init.signal?.aborted) throw new DOMException('Aborted', 'AbortError')
  return {
    status: raw.status,
    ok: raw.ok,
    headers: raw.headers,
    body: raw.body,
    bodyBytes: raw.body_b64 ? base64ToBytes(raw.body_b64) : undefined,
  }
}

// ── Client construction ──

const STATUS_TEXT: Record<number, string> = {
  200: 'OK', 201: 'Created', 202: 'Accepted', 204: 'No Content',
  301: 'Moved Permanently', 302: 'Found', 304: 'Not Modified',
  400: 'Bad Request', 401: 'Unauthorized', 403: 'Forbidden', 404: 'Not Found',
  409: 'Conflict', 422: 'Unprocessable Entity', 429: 'Too Many Requests',
  500: 'Internal Server Error', 502: 'Bad Gateway', 503: 'Service Unavailable', 504: 'Gateway Timeout',
}

const IDEMPOTENT: ReadonlySet<HttpMethod> = new Set(['GET', 'HEAD', 'OPTIONS', 'PUT', 'DELETE'])

function isAbsolute(url: string): boolean {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(url)
}

function buildUrl(baseUrl: string | undefined, url: string, params?: HttpRequestConfig['params']): string {
  let full = baseUrl && !isAbsolute(url) ? `${baseUrl.replace(/\/$/, '')}/${url.replace(/^\//, '')}` : url
  if (params) {
    const qs = new URLSearchParams()
    for (const [key, value] of Object.entries(params)) {
      if (value === null || value === undefined) continue
      if (Array.isArray(value)) {
        for (const v of value) qs.append(key, String(v))
      } else {
        qs.append(key, String(value))
      }
    }
    const query = qs.toString()
    if (query) full += (full.includes('?') ? '&' : '?') + query
  }
  return full
}

function makeHttpError(message: string, fields: Partial<HttpError>): HttpError {
  const err = new Error(message) as HttpError
  Object.assign(err, fields)
  return err
}

function isHttpError(err: unknown): err is HttpError {
  return err instanceof Error && ('status' in err || 'isNetworkError' in err || 'cancelled' in err)
}

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))

function createClient(initialDefaults: HttpClientDefaults = {}): HttpClient {
  const defaults: HttpClientDefaults = { retries: 0, timeoutMs: 15000, responseType: 'json', ...initialDefaults }

  const requestInterceptors = new Map<number, (c: HttpRequestConfig) => HttpRequestConfig | Promise<HttpRequestConfig>>()
  const responseFulfilled = new Map<number, (r: HttpResponse) => HttpResponse | Promise<HttpResponse>>()
  const responseRejected = new Map<number, (e: HttpError) => unknown>()
  let interceptorId = 0

  function serializeBody(data: unknown, headers: Record<string, string>): { body?: string; bodyBytes?: Uint8Array } {
    if (data === undefined || data === null) return {}
    if (typeof data === 'string') return { body: data }
    if (data instanceof Uint8Array) return { bodyBytes: data }
    if (typeof Blob !== 'undefined' && data instanceof Blob) {
      // Blob handled by caller (async). Placeholder — see request().
      return {}
    }
    // Plain object / array → JSON
    if (!headers['Content-Type'] && !headers['content-type']) {
      headers['Content-Type'] = 'application/json'
    }
    return { body: JSON.stringify(data) }
  }

  async function request<T = unknown>(config: HttpRequestConfig): Promise<HttpResponse<T>> {
    let merged: HttpRequestConfig = {
      ...config,
      method: config.method || 'GET',
      headers: { ...defaults.headers, ...config.headers },
      timeoutMs: config.timeoutMs ?? defaults.timeoutMs,
      retries: config.retries ?? defaults.retries ?? 0,
      responseType: config.responseType ?? defaults.responseType ?? 'json',
      throwOnError: config.throwOnError ?? true,
    }
    for (const fn of requestInterceptors.values()) merged = await fn(merged)

    const method = (merged.method || 'GET') as HttpMethod
    const headers = { ...merged.headers } as Record<string, string>
    const url = buildUrl(defaults.baseUrl, merged.url || '', merged.params)

    // Body serialization (Blob needs async read → handle here).
    let body: string | undefined
    let bodyBytes: Uint8Array | undefined
    if (typeof Blob !== 'undefined' && merged.data instanceof Blob) {
      bodyBytes = new Uint8Array(await merged.data.arrayBuffer())
    } else {
      const s = serializeBody(merged.data, headers)
      body = s.body
      bodyBytes = s.bodyBytes
    }

    const wantsBytes = merged.responseType === 'bytes' || merged.responseType === 'blob'
    const retries = merged.retries ?? 0

    let lastErr: HttpError | undefined
    for (let attempt = 0; attempt <= retries; attempt++) {
      if (merged.signal?.aborted) {
        throw makeHttpError('Request aborted', { cancelled: true, config: merged, url })
      }
      try {
        const raw = await rawFetch(url, {
          method,
          headers,
          body,
          bodyBytes,
          responseType: wantsBytes ? 'bytes' : 'text',
          timeoutMs: merged.timeoutMs,
          signal: merged.signal,
        })

        const statusText = STATUS_TEXT[raw.status] || ''
        let data: unknown
        if (merged.responseType === 'bytes') {
          data = raw.bodyBytes ?? new Uint8Array()
        } else if (merged.responseType === 'blob') {
          data = new Blob([(raw.bodyBytes ?? new Uint8Array()) as unknown as ArrayBuffer])
        } else if (merged.responseType === 'text') {
          data = raw.body
        } else if (raw.body) {
          // Default JSON parse, but never let a non-JSON body (common on error
          // responses) mask the HTTP status — fall back to the raw string.
          try { data = JSON.parse(raw.body) } catch { data = raw.body }
        } else {
          data = null
        }

        let response: HttpResponse<T> = {
          data: data as T,
          status: raw.status,
          statusText,
          headers: raw.headers,
          url,
        }

        if (!raw.ok && merged.throwOnError) {
          const err = makeHttpError(`Request failed with status ${raw.status}`, {
            status: raw.status,
            statusText,
            data,
            headers: raw.headers,
            url,
            config: merged,
          })
          // 5xx on an idempotent method is retryable.
          const retryable = raw.status >= 500 && IDEMPOTENT.has(method)
          if (attempt < retries && (merged.shouldRetry ? merged.shouldRetry(err, attempt) : retryable)) {
            lastErr = err
            await sleep(Math.min(250 * 2 ** attempt, 4000))
            continue
          }
          throw err
        }

        for (const fn of responseFulfilled.values()) response = (await fn(response)) as HttpResponse<T>
        return response
      } catch (e) {
        if (isHttpError(e) && (e.status !== undefined || e.cancelled)) throw e
        // Transport/network error (or abort).
        const aborted = e instanceof DOMException && e.name === 'AbortError'
        const err = makeHttpError(aborted ? 'Request aborted' : (e instanceof Error ? e.message : String(e)), {
          isNetworkError: !aborted,
          cancelled: aborted,
          url,
          config: merged,
        })
        const retryable = !aborted && IDEMPOTENT.has(method)
        if (attempt < retries && (merged.shouldRetry ? merged.shouldRetry(err, attempt) : retryable)) {
          lastErr = err
          await sleep(Math.min(250 * 2 ** attempt, 4000))
          continue
        }
        for (const fn of responseRejected.values()) {
          const recovered = await fn(err)
          if (recovered !== undefined) return recovered as HttpResponse<T>
        }
        throw err
      }
    }
    throw lastErr ?? makeHttpError('Request failed', { url })
  }

  const verb = <T>(method: HttpMethod, url: string, config?: HttpRequestConfig) =>
    request<T>({ ...config, method, url }).then(r => r.data)
  const verbWithData = <T>(method: HttpMethod, url: string, data?: unknown, config?: HttpRequestConfig) =>
    request<T>({ ...config, method, url, data }).then(r => r.data)

  const client: HttpClient = {
    get: (url, config) => verb('GET', url, config),
    delete: (url, config) => verb('DELETE', url, config),
    head: (url, config) => verb('HEAD', url, config),
    options: (url, config) => verb('OPTIONS', url, config),
    post: (url, data, config) => verbWithData('POST', url, data, config),
    put: (url, data, config) => verbWithData('PUT', url, data, config),
    patch: (url, data, config) => verbWithData('PATCH', url, data, config),
    request,
    create: (d) => createClient({ ...defaults, ...d }),
    defaults,
    interceptors: {
      request: {
        use(fn) { const id = ++interceptorId; requestInterceptors.set(id, fn); return id },
        eject(id) { requestInterceptors.delete(id) },
      },
      response: {
        use(onFulfilled, onRejected) {
          const id = ++interceptorId
          if (onFulfilled) responseFulfilled.set(id, onFulfilled)
          if (onRejected) responseRejected.set(id, onRejected)
          return id
        },
        eject(id) { responseFulfilled.delete(id); responseRejected.delete(id) },
      },
    },
    isHttpError,
    fetch: rawFetch,
  }
  return client
}

// Shared default client so interceptors/defaults set by a space persist across
// `useHttp()` calls (matches axios' default-instance behavior). `create()`
// spawns isolated clients when a space wants its own config.
const defaultClient = createClient()

export function useHttp(): HttpClient {
  return defaultClient
}
