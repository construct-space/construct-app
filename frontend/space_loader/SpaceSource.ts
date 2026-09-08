/**
 * SpaceSource — a uniform read interface over a space bundle, regardless of
 * whether it lives as an installed `.space` ZIP or an unpacked directory.
 *
 * - ZipSpaceSource: installed bundles. Reads entries straight from the ZIP via
 *   the `space_zip_*` IPC commands; asset URLs use the `space://` scheme.
 *   Nothing is extracted to disk.
 * - DirSpaceSource: dev/preview bundles (a project `dist/<id>.space/` dir, or a
 *   dev-linked unpacked space). Reads via plugin-fs; asset URLs use `asset://`
 *   through `convertFileSrc`.
 *
 * Entry resolution (which file is the JS bundle / the CSS) is implemented once
 * here on top of `listEntries()`, so the host never hardcodes `app.iife.js`.
 */
import { getSpaceDirPath } from '@/lib/appPaths'
import { resolveSpaceDirFromBase } from './spaceBundleResolver'

export interface SpaceSource {
  readonly spaceId: string
  readonly kind: 'zip' | 'dir'
  /** Top-level (and, for zip, nested) entry names — forward-slash, no leading slash. */
  listEntries(): Promise<string[]>
  entryExists(entry: string): Promise<boolean>
  readText(entry: string): Promise<string>
  readBytes(entry: string): Promise<Uint8Array>
  /** A URL the webview can load this entry from (space:// or asset://). Synchronous. */
  assetUrl(entry: string): string
}

/** Normalize "./a/../b" and leading slashes to a clean relative entry path. */
function normalizeEntryPath(entry: string): string {
  const parts = entry.replace(/\\/g, '/').split('/')
  const out: string[] = []
  for (const part of parts) {
    if (part === '' || part === '.') continue
    if (part === '..') {
      out.pop()
      continue
    }
    out.push(part)
  }
  return out.join('/')
}

export class ZipSpaceSource implements SpaceSource {
  readonly kind = 'zip' as const
  constructor(readonly spaceId: string) {}

  private async invoke<T>(cmd: string, args: Record<string, unknown>): Promise<T> {
    const { invoke } = await import('@tauri-apps/api/core')
    return invoke<T>(cmd, args)
  }

  listEntries(): Promise<string[]> {
    return this.invoke<string[]>('space_zip_list', { spaceId: this.spaceId })
  }

  entryExists(entry: string): Promise<boolean> {
    return this.invoke<boolean>('space_zip_exists', { spaceId: this.spaceId, entry })
  }

  readText(entry: string): Promise<string> {
    return this.invoke<string>('space_zip_read_text', { spaceId: this.spaceId, entry })
  }

  async readBytes(entry: string): Promise<Uint8Array> {
    const arr = await this.invoke<number[]>('space_zip_read_bytes', {
      spaceId: this.spaceId,
      entry,
    })
    return Uint8Array.from(arr)
  }

  assetUrl(entry: string): string {
    const clean = normalizeEntryPath(entry)
    const encoded = clean.split('/').map(encodeURIComponent).join('/')
    return `space://localhost/${encodeURIComponent(this.spaceId)}/${encoded}`
  }
}

export class DirSpaceSource implements SpaceSource {
  readonly kind = 'dir' as const
  constructor(
    readonly spaceId: string,
    readonly dir: string,
    private readonly toAssetUrl: (path: string) => string,
  ) {}

  async listEntries(): Promise<string[]> {
    const { readDir } = await import('@tauri-apps/plugin-fs')
    const entries = await readDir(this.dir)
    // Top-level names are enough for JS/CSS entry resolution; nested lookups
    // go through entryExists (fs.exists handles arbitrary depth).
    return entries.filter(e => e.isFile).map(e => e.name)
  }

  entryExists(entry: string): Promise<boolean> {
    return import('@tauri-apps/plugin-fs').then(({ exists }) => exists(`${this.dir}/${entry}`))
  }

  readText(entry: string): Promise<string> {
    return import('@tauri-apps/plugin-fs').then(({ readTextFile }) =>
      readTextFile(`${this.dir}/${entry}`),
    )
  }

  readBytes(entry: string): Promise<Uint8Array> {
    return import('@tauri-apps/plugin-fs').then(({ readFile }) => readFile(`${this.dir}/${entry}`))
  }

  assetUrl(entry: string): string {
    const clean = entry.startsWith('/') ? entry : `${this.dir}/${normalizeEntryPath(entry)}`
    return this.toAssetUrl(clean)
  }
}

/**
 * Pick the JS bundle entry: prefer the canonical `app.iife.js`, then the newer
 * per-space `space-<id>.iife.js`, then any top-level `*.iife.js`. This is the
 * fix for bundles whose CLI renamed the entry — the host no longer assumes a
 * fixed filename.
 */
export async function resolveJsEntry(src: SpaceSource): Promise<string | null> {
  const top = (await src.listEntries()).filter(e => !e.includes('/'))
  return (
    top.find(e => e === 'app.iife.js') ??
    top.find(e => e === `space-${src.spaceId}.iife.js`) ??
    top.find(e => e.endsWith('.iife.js')) ??
    null
  )
}

/**
 * Pick CSS entries (0..n). Prefer `style.css`, then `space-<id>.css`, then any
 * other top-level `*.css`. Returns [] when CSS is inlined into the bundle —
 * that's valid, not an error.
 */
export async function resolveCssEntries(src: SpaceSource): Promise<string[]> {
  const top = (await src.listEntries()).filter(e => !e.includes('/') && e.endsWith('.css'))
  const ordered: string[] = []
  for (const preferred of ['style.css', `space-${src.spaceId}.css`]) {
    if (top.includes(preferred)) ordered.push(preferred)
  }
  for (const css of top) {
    if (!ordered.includes(css)) ordered.push(css)
  }
  return ordered
}

/** Capture convertFileSrc once (sync after import); identity fallback for tests/browser. */
async function dirAssetUrlFn(): Promise<(path: string) => string> {
  try {
    const { convertFileSrc } = await import('@tauri-apps/api/core')
    return convertFileSrc
  } catch {
    return (path: string) => path
  }
}

/**
 * Build the right SpaceSource for a space.
 * - `baseDir` omitted → installed space: a `.space` ZIP (ZipSpaceSource) or, if
 *   it's an unpacked dir (dev-linked), a DirSpaceSource.
 * - `baseDir` given → dev/preview: resolve to a concrete dir and use DirSpaceSource.
 * Returns null when no loadable bundle (manifest) is found.
 */
export async function createSpaceSource(
  spaceId: string,
  baseDir?: string,
): Promise<SpaceSource | null> {
  const { exists } = await import('@tauri-apps/plugin-fs')

  if (baseDir === undefined) {
    const { homeDir } = await import('@tauri-apps/api/path')
    const installed = getSpaceDirPath(await homeDir(), spaceId)
    // An unpacked <id>.space directory (dev-linked) has a real manifest file;
    // a ZIP file does not. Route accordingly.
    if (await exists(`${installed}/manifest.json`)) {
      return new DirSpaceSource(spaceId, installed, await dirAssetUrlFn())
    }
    if (await exists(installed)) {
      return new ZipSpaceSource(spaceId)
    }
    return null
  }

  const dir = await resolveSpaceDirFromBase(spaceId, baseDir)
  if (await exists(`${dir}/manifest.json`)) {
    return new DirSpaceSource(spaceId, dir, await dirAssetUrlFn())
  }
  return null
}
