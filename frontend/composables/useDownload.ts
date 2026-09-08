/**
 * useDownload — save bytes to disk.
 *
 * In the desktop (Tauri) app we write straight into the user's Downloads
 * folder via plugin-fs — no save panel, no prompt — matching what people
 * expect from a "Download" button. On the web (or if the FS write is denied)
 * we fall back to an anchor[download] click. `saveUrl()` fetches first.
 */

import type { DownloadOptions } from '@construct-space/sdk'
import { isTauriEnv } from '@/utils/tauri'

function mimeFromExt(filename: string): string {
  const ext = filename.toLowerCase().split('.').pop() || ''
  switch (ext) {
    case 'csv': return 'text/csv'
    case 'tsv': return 'text/tab-separated-values'
    case 'json': return 'application/json'
    case 'txt': return 'text/plain'
    case 'md': return 'text/markdown'
    case 'xlsx': return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    case 'pdf': return 'application/pdf'
    default: return 'application/octet-stream'
  }
}

// Desktop: write the bytes straight to ~/Downloads (no save panel). Returns
// false when not in Tauri or if the FS write is unavailable/denied, so the
// caller can fall back to the browser anchor download.
async function saveToDownloadsDir(blob: Blob, filename: string): Promise<boolean> {
  if (!isTauriEnv()) return false
  try {
    const { writeFile, exists, BaseDirectory } = await import('@tauri-apps/plugin-fs')
    const dot = filename.lastIndexOf('.')
    const stem = dot > 0 ? filename.slice(0, dot) : filename
    const ext = dot > 0 ? filename.slice(dot) : ''
    // Don't clobber an existing file: foo.pdf → foo (1).pdf → foo (2).pdf …
    let name = filename
    for (let n = 1; n <= 99; n++) {
      if (!(await exists(name, { baseDir: BaseDirectory.Download }).catch(() => false))) break
      name = `${stem} (${n})${ext}`
    }
    await writeFile(name, new Uint8Array(await blob.arrayBuffer()), { baseDir: BaseDirectory.Download })
    return true
  } catch (e) {
    console.warn('[download] direct-to-Downloads unavailable, using browser download:', e)
    return false
  }
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.style.display = 'none'
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  // Revoke after a tick so the click handler can complete.
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

export function useDownload() {
  async function save(
    data: Blob | string | Uint8Array,
    opts: DownloadOptions,
  ): Promise<void> {
    const filename = opts.filename
    const type = opts.contentType || mimeFromExt(filename)
    let blob: Blob
    if (data instanceof Blob) blob = data
    else if (typeof data === 'string') blob = new Blob([data], { type })
    else blob = new Blob([data as BlobPart], { type })
    if (await saveToDownloadsDir(blob, filename)) return
    triggerDownload(blob, filename)
  }

  async function saveUrl(url: string, opts: DownloadOptions): Promise<void> {
    const res = await fetch(url)
    if (!res.ok) throw new Error(`saveUrl: ${res.status} ${res.statusText}`)
    const blob = await res.blob()
    await save(blob, opts)
  }

  return { save, saveUrl }
}
