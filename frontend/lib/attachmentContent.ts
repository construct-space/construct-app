/**
 * Turn the attachment blocks emitted by AgentInput into the brain's
 * multimodal `content` array (text + image blocks).
 *
 * AgentInput attaches images two ways depending on environment:
 *  - Tauri: writes the bytes to a tmp file and emits `{ type:'file', path }`.
 *  - Browser fallback: emits `{ type:'image', src: <data-url> }`.
 *
 * The brain's prompt payload takes `content: [{type:'text'}|{type:'image',url}]`
 * where image urls are data: URLs (decoded at the wire) or http(s) URLs.
 * Tauri file paths are NOT fetchable by the brain (asset:// is a webview-only
 * protocol), so we read the bytes and inline them as a base64 data URL.
 *
 * Non-image file attachments can't go in `content` (brain content is
 * text+image only) — their paths are returned separately so the caller can
 * append them to the prompt text for the agent to `read` by path.
 */
import type { RequestBlock, ImageBlock } from '@/assistant'

export type BrainContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; url: string }

const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp'])

function isImageName(name: string): boolean {
  const ext = name.split('.').pop()?.toLowerCase() || ''
  return IMAGE_EXT.has(ext)
}

function mimeFromName(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() || ''
  switch (ext) {
    case 'jpg':
    case 'jpeg': return 'image/jpeg'
    case 'gif': return 'image/gif'
    case 'webp': return 'image/webp'
    case 'svg': return 'image/svg+xml'
    case 'bmp': return 'image/bmp'
    default: return 'image/png'
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

async function fileToDataUrl(path: string, name: string): Promise<string | null> {
  try {
    const { isTauriEnv } = await import('@/utils/tauri')
    if (!isTauriEnv()) return null
    const { readFile } = await import('@tauri-apps/plugin-fs')
    const bytes = await readFile(path)
    return `data:${mimeFromName(name)};base64,${bytesToBase64(bytes)}`
  } catch {
    return null
  }
}

export interface AttachmentContent {
  /** Image blocks ready for BrainPromptPayload.content. */
  images: Array<{ type: 'image'; url: string }>
  /** Paths of non-image file attachments (for the agent to read by path). */
  filePaths: Array<{ path: string; name: string }>
}

/**
 * Resolve AgentInput attachment blocks into brain content. Images become
 * inline data-URL image blocks; non-image files are returned as paths.
 */
export async function resolveAttachments(blocks: RequestBlock[]): Promise<AttachmentContent> {
  const images: Array<{ type: 'image'; url: string }> = []
  const filePaths: Array<{ path: string; name: string }> = []

  for (const b of blocks) {
    if (b.type === 'image') {
      const src = (b as ImageBlock).src
      if (src) images.push({ type: 'image', url: src })
      continue
    }
    if (b.type === 'file') {
      const fb = b as RequestBlock & { path?: string; name?: string }
      const name = fb.name || (fb.path ? fb.path.split('/').pop() || '' : '')
      if (!fb.path) continue
      if (isImageName(name)) {
        const url = await fileToDataUrl(fb.path, name)
        if (url) images.push({ type: 'image', url })
        else filePaths.push({ path: fb.path, name }) // couldn't inline — let agent read it
      } else {
        filePaths.push({ path: fb.path, name })
      }
    }
  }

  return { images, filePaths }
}
