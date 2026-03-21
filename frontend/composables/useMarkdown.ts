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

  isInitialized = true
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

  const rawHtml = marked.parse(content) as string
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
    initModules,
  }
}
