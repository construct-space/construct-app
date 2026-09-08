/**
 * useStorage — file/blob storage scoped to the active space.
 *
 * Routes calls through the gateway-proxied storage-api service
 * (`<gatewayUrl>/api/storage/*` → `api/storage/`). The gateway auth_requests
 * the user's session, then injects `X-Internal-Secret` before forwarding
 * to storage-api — so spaces hit `useStorage()` with just their session
 * token, and storage-api sees both the user identity AND the trusted
 * admin secret. Brain is NOT in this path.
 *
 * Bucket + key are derived host-side: `bucket = 'space-blobs'`,
 * `key = '<space-id>/<path>'`. Spaces never pick buckets or see another
 * space's namespace. The space context comes from the active space (set
 * by spaceHost when the bundle mounts).
 */

import { ref } from 'vue'
import type { Ref } from 'vue'
import type {
  UploadOptions,
  UploadResult,
  PresignOptions,
  PresignResult,
  SignedUrlOptions,
  ListOptions,
  ListResult,
  CopyOptions,
} from '@construct-space/sdk'
import { useAuthStore } from '@/stores/auth'
import { appConfig } from '@/utils/config'

/**
 * Bucket selection. We run two R2 buckets behind storage-api:
 *
 *   - `construct`                 — default region (US/global)
 *   - `construct-space-data-eu`   — EU residency
 *
 * Both must be in `ALLOWED_BUCKETS` server-side. The host picks per-request
 * based on (in priority order):
 *
 *   1. Explicit override on the user record  (`user.dataRegion = 'eu' | 'us'`)
 *      — wins because it's the user's stated preference.
 *   2. Active-org data-residency policy       (`org.dataResidency = 'eu' | 'us'`)
 *      — when an EU-resident org has any user (anywhere), EU is the right
 *        bucket for that org's data.
 *   3. Browser timezone heuristic             (`Europe/*` → EU)
 *      — last-resort default for fresh installs / pre-login.
 *
 * Spaces never pick the bucket. Same path written to the EU bucket vs the
 * default bucket lives in entirely separate storage; clients have no way
 * to cross. The selection is sticky per session — once a bucket is picked
 * for this auth session, every upload + read uses the same one until
 * sign-out, so a user never gets "now you see your files, now you don't".
 */
const DEFAULT_BUCKET = 'construct'
const EU_BUCKET = 'construct-space-data-eu'

type UserLike = { dataRegion?: string | null } | null | undefined
type OrgLike = { dataResidency?: string | null } | null | undefined

function pickBucket(user: UserLike, org: OrgLike): string {
  const userPref = (user?.dataRegion ?? '').toLowerCase()
  if (userPref === 'eu') return EU_BUCKET
  if (userPref === 'us' || userPref === 'global') return DEFAULT_BUCKET

  const orgPolicy = (org?.dataResidency ?? '').toLowerCase()
  if (orgPolicy === 'eu') return EU_BUCKET
  if (orgPolicy === 'us' || orgPolicy === 'global') return DEFAULT_BUCKET

  // Timezone fallback. Cheap, no schema change required — gets 95% right
  // for users who haven't set a region yet. Anything starting with
  // `Europe/` lands in the EU bucket; everything else defaults.
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ''
    if (tz.startsWith('Europe/')) return EU_BUCKET
  } catch {
    /* Intl unavailable — fall through to default */
  }
  return DEFAULT_BUCKET
}

function activeSpaceId(): string {
  const c = (globalThis as { construct?: { space?: { id?: string } } }).construct
  return c?.space?.id ?? 'unknown'
}

function activeOrg(): OrgLike {
  const c = (globalThis as { construct?: { org?: OrgLike } }).construct
  return c?.org ?? null
}

function buildKey(path: string): string {
  // Strip leading slashes so the key is always `<space-id>/<path>` (no
  // double-slash, no parent escapes). Reject absolute or traversal paths.
  const cleaned = path.replace(/^\/+/, '').replace(/\.\.+\//g, '')
  // Shared org keyspace opt-in: a space that wants a file readable by every
  // org member (e.g. a team Drive) passes a path already rooted at
  // `orgs/<orgId>/...`. Pass it through verbatim instead of burying it under
  // this user's `<space-id>/` prefix — storage-api authorizes the
  // `orgs/<orgId>/` prefix against the gateway-verified X-Auth-Org-ID.
  if (cleaned.startsWith('orgs/') || cleaned.startsWith('org/')) {
    return cleaned
  }
  return `${activeSpaceId()}/${cleaned}`
}

function buildHeaders(token: string | null): Headers {
  const h = new Headers({ 'Content-Type': 'application/json' })
  if (token) h.set('Authorization', `Bearer ${token}`)
  return h
}

async function readError(res: Response): Promise<string> {
  const txt = await res.text().catch(() => '')
  try {
    const j = JSON.parse(txt) as { error?: string; message?: string }
    return j.error || j.message || txt || `Request failed (${res.status})`
  } catch {
    return txt || `Request failed (${res.status})`
  }
}

export function useStorage() {
  const loading: Ref<boolean> = ref(false)
  const error: Ref<string | null> = ref(null)
  const auth = useAuthStore()
  const base = appConfig.storageUrl.replace(/\/$/, '')
  // Pick bucket once at composable construction so it's stable for the
  // lifetime of this useStorage() instance — a user can't see their own
  // file as "missing" because the second call picked a different bucket
  // mid-session. Re-mount the space (sign-in/out/profile-switch) to re-pick.
  const bucket = pickBucket(
    auth.user as UserLike,
    activeOrg(),
  )

  async function presign(opts: PresignOptions = {}): Promise<PresignResult> {
    loading.value = true
    error.value = null
    try {
      const key = buildKey(opts.path ?? `upload-${Date.now()}`)
      const res = await fetch(`${base}/presign`, {
        method: 'POST',
        headers: buildHeaders(auth.token),
        body: JSON.stringify({
          bucket: bucket,
          key,
          content_type: opts.contentType,
          expires_in: opts.ttlSeconds,
        }),
      })
      if (!res.ok) throw new Error(await readError(res))
      // storage-api speaks snake_case (`public_url`, `expires_at`).
      // SDK contract is camelCase. Normalize at the wire boundary so
      // every caller above can rely on the typed shape — the previous
      // version read `data.publicUrl` and got undefined, which stranded
      // empty URLs on file rows (placeholder thumbnails everywhere).
      const raw = (await res.json()) as Record<string, unknown>
      return {
        url: String(raw.url ?? ''),
        publicUrl: String(raw.public_url ?? ''),
        path: opts.path ?? key,
      } as PresignResult
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e)
      throw e
    } finally {
      loading.value = false
    }
  }

  async function upload(file: Blob | File, opts: UploadOptions = {}): Promise<UploadResult> {
    loading.value = true
    error.value = null
    try {
      const path = opts.path ?? (file instanceof File ? file.name : `upload-${Date.now()}`)
      const key = buildKey(path)
      const contentType = opts.contentType ?? (file.type || 'application/octet-stream')

      // Large files (≥ proxy limit) get presigned + direct-PUT to R2. Small
      // files use the proxy-upload endpoint so storage-api can apply
      // mime/size policy server-side. Threshold matches storage-api's
      // MaxUploadBytes (default 10 MB).
      const PROXY_LIMIT = 10 * 1024 * 1024
      if (file.size > PROXY_LIMIT || opts.proxy === false) {
        const ps = await presign({ path, contentType })
        const put = await fetch(ps.url, { method: 'PUT', body: file, headers: { 'Content-Type': contentType } })
        if (!put.ok) throw new Error(`Upload failed (${put.status})`)
        return { path, url: ps.publicUrl }
      }

      // Proxy upload — multipart form so storage-api can enforce mime + size.
      const form = new FormData()
      form.append('bucket', bucket)
      form.append('key', key)
      form.append('file', file, path.split('/').pop() || 'file')
      const headers = new Headers()
      if (auth.token) headers.set('Authorization', `Bearer ${auth.token}`)
      const res = await fetch(`${base}/upload`, { method: 'POST', headers, body: form })
      if (!res.ok) throw new Error(await readError(res))
      // Proxy-upload returns { public_url, key, bucket, size } — no
      // top-level `url`. Map public_url to the SDK contract.
      const data = (await res.json()) as Record<string, unknown>
      return { path, url: String(data.public_url ?? '') }
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e)
      throw e
    } finally {
      loading.value = false
    }
  }

  async function signedUrl(opts: SignedUrlOptions): Promise<string> {
    const ps = await presign({ path: opts.path, ttlSeconds: opts.ttlSeconds })
    return ps.publicUrl ?? ps.url
  }

  async function download(path: string): Promise<Blob> {
    loading.value = true
    error.value = null
    try {
      const key = buildKey(path)
      // mode=stream: proxy the bytes back through storage-api (same-origin)
      // instead of the default 302 to the eu-cdn presigned URL. Following
      // that cross-origin redirect re-triggers CORS in the webview (the CDN
      // sends no Access-Control-Allow-Origin); streaming keeps the whole
      // round-trip on the gateway origin so the fetch succeeds.
      const res = await fetch(`${base}/${bucket}/${key}?mode=stream`, { headers: buildHeaders(auth.token) })
      if (!res.ok) throw new Error(await readError(res))
      return await res.blob()
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e)
      throw e
    } finally {
      loading.value = false
    }
  }

  async function del(path: string): Promise<void> {
    loading.value = true
    error.value = null
    try {
      const key = buildKey(path)
      // storage-api exposes DELETE on /internal/storage/... — the gateway
      // remaps /api/storage/<bucket>/<key> to that internal route when the
      // method is DELETE. See web/my/nginx.conf.template.
      const res = await fetch(`${base}/${bucket}/${key}`, {
        method: 'DELETE',
        headers: buildHeaders(auth.token),
      })
      if (!res.ok) throw new Error(await readError(res))
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e)
      throw e
    } finally {
      loading.value = false
    }
  }

  async function list(opts: ListOptions = {}): Promise<ListResult> {
    loading.value = true
    error.value = null
    try {
      const prefix = buildKey(opts.prefix ?? '')
      const url = new URL(`${base}/${bucket}/list`)
      url.searchParams.set('prefix', prefix)
      if (opts.limit) url.searchParams.set('limit', String(opts.limit))
      const res = await fetch(url.toString(), { headers: buildHeaders(auth.token) })
      if (!res.ok) throw new Error(await readError(res))
      const data = (await res.json()) as ListResult
      return data
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e)
      throw e
    } finally {
      loading.value = false
    }
  }

  async function copy(_opts: CopyOptions): Promise<void> {
    // storage-api doesn't currently expose a server-side copy. Until it
    // does, callers should download() + upload() — that's slower but
    // works against the existing surface. Surfacing as a clear error so
    // spaces don't silently fail.
    throw new Error('storage.copy is not supported by storage-api yet — download() + upload() instead')
  }

  async function exists(path: string): Promise<boolean> {
    try {
      const key = buildKey(path)
      const res = await fetch(`${base}/${bucket}/${key}`, {
        method: 'HEAD',
        headers: buildHeaders(auth.token),
      })
      return res.ok
    } catch {
      return false
    }
  }

  return {
    loading,
    error,
    upload,
    presign,
    signedUrl,
    download,
    delete: del,
    list,
    copy,
    exists,
  }
}
