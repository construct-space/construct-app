/**
 * Safe Markdown Rendering Composable
 *
 * Renders markdown to HTML with DOMPurify sanitization to prevent XSS attacks.
 * Uses lazy initialization to avoid build-time issues.
 */

// Lazy-loaded modules to avoid build-time maximum call stack issues
let DOMPurify: typeof import('dompurify').default | null = null
let marked: typeof import('marked').marked | null = null
let isInitialized = false

// DOMPurify configuration - whitelist only safe tags and attributes
const DOMPURIFY_CONFIG = {
  ALLOWED_TAGS: [
    'p', 'br', 'strong', 'b', 'em', 'i', 'code', 'pre',
    'ul', 'ol', 'li', 'a', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'blockquote', 'hr', 'table', 'thead', 'tbody', 'tr', 'th', 'td',
    'span', 'div', 'img'
  ],
  ALLOWED_ATTR: ['href', 'class', 'target', 'rel', 'src', 'alt', 'title'],
  ALLOW_DATA_ATTR: false,
  ADD_ATTR: ['target'],
}

// Initialize modules lazily (only in browser)
async function initModules() {
  if (isInitialized || typeof window === 'undefined') return

  const [dompurifyModule, markedModule] = await Promise.all([
    import('dompurify'),
    import('marked')
  ])

  DOMPurify = dompurifyModule.default
  marked = markedModule.marked

  // Configure marked for safe rendering
  marked.setOptions({
    breaks: true,
    gfm: true,
  })

  // Force all links to open in new window so they don't replace the Vue app
  DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    if (node.tagName === 'A') {
      node.setAttribute('target', '_blank')
      node.setAttribute('rel', 'noopener noreferrer')
    }
  })

  // Tauri-aware image rewrite. The screenshot_window bridge returns a
  // filesystem path like /tmp/construct-space-*.png. Agents sometimes
  // embed that path directly in markdown (![](/tmp/...)) — the webview
  // can't load absolute filesystem paths as http URLs, so the <img>
  // shows broken. Rewrite those srcs via Tauri's asset protocol
  // (configured with ["**"] scope in tauri.conf.json) so the image
  // loads through asset://localhost/.
  const { convertFileSrc } = await import('@tauri-apps/api/core')
  DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    if (node.tagName !== 'IMG') return
    const src = node.getAttribute('src')
    if (!src) return
    // Only rewrite absolute filesystem paths. Leave http(s), data: and
    // asset: URLs alone — they already work as-is.
    if (src.startsWith('/') && !src.startsWith('//')) {
      try {
        node.setAttribute('src', convertFileSrc(src))
      } catch {
        // Not running in Tauri (unit tests, browser preview) — leave
        // the path unchanged. The img will still break but without a
        // hard error.
      }
    }
  })

  isInitialized = true
}

// Collapse whitespace/newlines between `]` and `(` so wrapped image
// syntax `![alt]\n(data:image/...)` still parses as an image. Agents
// sometimes break the line between the alt and the URL when the data:
// URI is huge, which would otherwise dump the base64 blob as text.
function normalizeImageSyntax(content: string): string {
  return content.replace(/!\[([^\]\n]*)\]\s*\n\s*\(/g, '![$1](')
}

/**
 * Render markdown content to sanitized HTML
 * @param content - Markdown string to render
 * @returns Sanitized HTML string
 */
export function renderMarkdown(content: string): string {
  if (!content) return ''

  // During SSR or before initialization, return escaped content
  if (!isInitialized || !marked || !DOMPurify) {
    // Simple escape for SSR - will be hydrated properly on client
    return content
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
  }

  const rawHtml = marked.parse(normalizeImageSyntax(content)) as string
  return DOMPurify.sanitize(rawHtml, DOMPURIFY_CONFIG) as string
}

/**
 * Render streaming markdown content safely
 * Handles incomplete code blocks and other partial markdown
 * @param content - Partial markdown string being streamed
 * @returns Sanitized HTML string
 */
export function renderStreamingMarkdown(content: string): string {
  if (!content) return ''

  let safeContent = content

  // Hide an incomplete `![alt](data:image/...` while the giant base64
  // is still streaming — otherwise we render the raw blob as text.
  const lastImg = safeContent.lastIndexOf('![')
  if (lastImg !== -1) {
    const after = safeContent.slice(lastImg)
    const m = after.match(/^!\[[^\]\n]*\]\s*\n?\s*\(\s*data:/)
    if (m && after.indexOf(')', m[0].length) === -1) {
      safeContent = safeContent.slice(0, lastImg) + '_(loading image…)_'
    }
  }

  // Close unclosed code blocks
  const codeBlockCount = (safeContent.match(/```/g) || []).length
  if (codeBlockCount % 2 !== 0) {
    safeContent += '\n```'
  }

  // Close unclosed inline code
  const inlineCodeCount = (safeContent.match(/(?<!`)`(?!`)/g) || []).length
  if (inlineCodeCount % 2 !== 0) {
    safeContent += '`'
  }

  // Close unclosed bold
  const boldCount = (safeContent.match(/\*\*/g) || []).length
  if (boldCount % 2 !== 0) {
    safeContent += '**'
  }

  // Close unclosed italic (single *)
  const italicMatches = safeContent.match(/(?<!\*)\*(?!\*)/g) || []
  if (italicMatches.length % 2 !== 0) {
    safeContent += '*'
  }

  return renderMarkdown(safeContent)
}

/**
 * Split a markdown string into top-level block segments at blank-line
 * boundaries, while respecting fenced code blocks (which may contain
 * blank lines internally).
 *
 * Used by streaming render to freeze "completed" blocks (everything
 * before the last block, since a blank line marks the previous block
 * as terminated) and only re-parse the in-flight tail on each chunk.
 *
 * Tables and lists don't span blank lines in CommonMark, so the
 * boundary heuristic is safe for them.
 */
export function splitMarkdownBlocks(content: string): string[] {
  if (!content) return []
  const lines = content.split('\n')
  const blocks: string[] = []
  let current: string[] = []
  let inFence = false

  const flush = () => {
    if (current.length === 0) return
    // Drop pure-whitespace blocks (consecutive blank lines)
    const text = current.join('\n')
    if (text.trim()) blocks.push(text)
    current = []
  }

  for (const line of lines) {
    // Toggle fence on lines that open/close a code block. Tilde fences
    // (`~~~`) are also valid in GFM but rarely emitted by models — the
    // backtick form covers the realistic streaming output.
    if (/^\s{0,3}```/.test(line)) inFence = !inFence

    if (!inFence && line.trim() === '') {
      flush()
      continue
    }
    current.push(line)
  }
  flush()
  return blocks
}

// Cache rendered HTML for completed (immutable) markdown blocks. Keyed
// by raw block content. Bounded so a long session doesn't grow it
// unboundedly. The cache turns repeated re-render of the same paragraph
// into a constant-time reference return — Vue's v-html sees the same
// string reference and skips the DOM patch entirely.
const completedBlockCache = new Map<string, string>()
const COMPLETED_CACHE_MAX = 500

function renderCompletedBlock(block: string): string {
  const cached = completedBlockCache.get(block)
  if (cached !== undefined) return cached
  const html = renderMarkdown(block)
  if (completedBlockCache.size >= COMPLETED_CACHE_MAX) {
    // Drop oldest insertion (Map preserves insertion order).
    const oldest = completedBlockCache.keys().next().value
    if (oldest !== undefined) completedBlockCache.delete(oldest)
  }
  completedBlockCache.set(block, html)
  return html
}

// djb2 — short, stable, collision-rate fine for v-for keys.
function shortHash(s: string): string {
  let h = 5381
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0
  return (h >>> 0).toString(36)
}

export type MarkdownPart = { key: string; html: string }

/**
 * Render markdown for streaming display as an array of independently
 * keyed parts. Completed blocks (everything before the last one) are
 * rendered with the strict parser and cached; the in-flight tail uses
 * `renderStreamingMarkdown` (which closes unbalanced syntax).
 *
 * Pair with a `<div v-for="p in parts" :key="p.key" v-html="p.html"/>`
 * loop. Vue keys keep completed blocks mounted across chunks, so only
 * the tail's DOM is patched per token — no flicker on stable content.
 */
export function renderStreamingMarkdownParts(content: string): MarkdownPart[] {
  if (!content) return []
  const blocks = splitMarkdownBlocks(content)
  if (blocks.length === 0) return []

  const parts: MarkdownPart[] = []
  for (let i = 0; i < blocks.length - 1; i++) {
    const block = blocks[i]
    parts.push({ key: `done:${shortHash(block)}`, html: renderCompletedBlock(block) })
  }
  // In-flight tail — re-render each chunk; stable key so Vue patches
  // the same node rather than recreating it.
  const tail = blocks[blocks.length - 1]
  parts.push({ key: 'tail', html: renderStreamingMarkdown(tail) })
  return parts
}

/**
 * Static (non-streaming) variant. Splits and renders each block
 * separately, with caching. Used for finalized turns so completed
 * paragraphs share the cache with the streaming pass that produced
 * them — no re-parse cost when a streamed turn settles.
 */
export function renderMarkdownParts(content: string): MarkdownPart[] {
  if (!content) return []
  const blocks = splitMarkdownBlocks(content)
  return blocks.map(block => ({
    key: `done:${shortHash(block)}`,
    html: renderCompletedBlock(block),
  }))
}

/**
 * Composable for markdown rendering
 * Call this in setup to ensure modules are loaded
 */
export function useMarkdown() {
  // Initialize on first use (client-side only)
  if (typeof window !== 'undefined') {
    initModules()
  }

  return {
    renderMarkdown,
    renderStreamingMarkdown,
    renderMarkdownParts,
    renderStreamingMarkdownParts,
    initModules,
  }
}
