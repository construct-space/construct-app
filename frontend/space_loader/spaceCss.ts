/**
 * CSS isolation helpers for dynamic spaces.
 *
 * Dynamic space styles are loaded from user/profile storage and must not be
 * able to style the host shell. The host document receives a prefixed copy;
 * widgets receive the unprefixed copy inside Shadow DOM.
 */

const SCOPED_GROUP_AT_RULES = new Set(['media', 'supports', 'container', 'layer', 'document'])

/**
 * In release WebViews we have seen SFC `__scopeId` metadata survive in the
 * bundle while the rendered DOM does not consistently receive the matching
 * `data-v-*` attributes. Keep a fallback copy for the space boundary only.
 */
export function buildVueScopedFallback(css: string): string {
  const fallback = css.replace(/\[data-v-[a-f0-9]+\]/g, '')
  if (fallback === css) return ''
  return `/* Vue scoped selector fallback for dynamic spaces. */\n${fallback}`
}

function cssAttrEscape(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

function spaceScopeSelector(spaceId: string): string {
  return `[data-construct-space="${cssAttrEscape(spaceId)}"]`
}

function findNextRuleOpen(css: string, start: number): number {
  let quote: '"' | "'" | null = null
  let inComment = false

  for (let i = start; i < css.length; i++) {
    const ch = css[i]
    const next = css[i + 1]

    if (inComment) {
      if (ch === '*' && next === '/') {
        inComment = false
        i++
      }
      continue
    }

    if (quote) {
      if (ch === '\\') {
        i++
      } else if (ch === quote) {
        quote = null
      }
      continue
    }

    if (ch === '/' && next === '*') {
      inComment = true
      i++
      continue
    }
    if (ch === '"' || ch === "'") {
      quote = ch
      continue
    }
    if (ch === '{') return i
  }

  return -1
}

function findRuleClose(css: string, openIndex: number): number {
  let depth = 1
  let quote: '"' | "'" | null = null
  let inComment = false

  for (let i = openIndex + 1; i < css.length; i++) {
    const ch = css[i]
    const next = css[i + 1]

    if (inComment) {
      if (ch === '*' && next === '/') {
        inComment = false
        i++
      }
      continue
    }

    if (quote) {
      if (ch === '\\') {
        i++
      } else if (ch === quote) {
        quote = null
      }
      continue
    }

    if (ch === '/' && next === '*') {
      inComment = true
      i++
      continue
    }
    if (ch === '"' || ch === "'") {
      quote = ch
      continue
    }
    if (ch === '{') {
      depth++
    } else if (ch === '}') {
      depth--
      if (depth === 0) return i
    }
  }

  return -1
}

function findNextTopLevelSemicolon(css: string, start: number): number {
  let quote: '"' | "'" | null = null
  let inComment = false
  let parenDepth = 0

  for (let i = start; i < css.length; i++) {
    const ch = css[i]
    const next = css[i + 1]

    if (inComment) {
      if (ch === '*' && next === '/') {
        inComment = false
        i++
      }
      continue
    }

    if (quote) {
      if (ch === '\\') {
        i++
      } else if (ch === quote) {
        quote = null
      }
      continue
    }

    if (ch === '/' && next === '*') {
      inComment = true
      i++
      continue
    }
    if (ch === '"' || ch === "'") {
      quote = ch
      continue
    }
    if (ch === '(') parenDepth++
    else if (ch === ')') parenDepth = Math.max(0, parenDepth - 1)
    else if (ch === ';' && parenDepth === 0) return i
    else if (ch === '{' && parenDepth === 0) return -1
  }

  return -1
}

function splitSelectorList(prelude: string): string[] {
  const selectors: string[] = []
  let start = 0
  let quote: '"' | "'" | null = null
  let bracketDepth = 0
  let parenDepth = 0

  for (let i = 0; i < prelude.length; i++) {
    const ch = prelude[i]

    if (quote) {
      if (ch === '\\') {
        i++
      } else if (ch === quote) {
        quote = null
      }
      continue
    }

    if (ch === '"' || ch === "'") {
      quote = ch
      continue
    }
    if (ch === '[') bracketDepth++
    else if (ch === ']') bracketDepth = Math.max(0, bracketDepth - 1)
    else if (ch === '(') parenDepth++
    else if (ch === ')') parenDepth = Math.max(0, parenDepth - 1)
    else if (ch === ',' && bracketDepth === 0 && parenDepth === 0) {
      selectors.push(prelude.slice(start, i))
      start = i + 1
    }
  }

  selectors.push(prelude.slice(start))
  return selectors
}

function scopeSingleSelector(selector: string, scope: string): string {
  const trailing = selector.match(/\s*$/)?.[0] ?? ''
  const withoutTrailing = selector.slice(0, selector.length - trailing.length)
  let offset = 0

  while (offset < withoutTrailing.length) {
    const ch = withoutTrailing[offset]
    const next = withoutTrailing[offset + 1]
    if (/\s/.test(ch)) {
      offset++
      continue
    }
    if (ch === '/' && next === '*') {
      const close = withoutTrailing.indexOf('*/', offset + 2)
      if (close === -1) break
      offset = close + 2
      continue
    }
    break
  }

  const leading = withoutTrailing.slice(0, offset)
  let body = withoutTrailing.slice(offset).trim()
  if (!body || body.startsWith(scope)) return selector

  if (body.includes(':host')) {
    body = body.replace(/:host(?:\(([^)]*)\))?/g, (_, hostSelector: string | undefined) => {
      return hostSelector ? `${scope}${hostSelector}` : scope
    })
    return `${leading}${body}${trailing}`
  }

  if (/^(?:html|body|:root)(?=$|[\s.#:[>+~])/.test(body)) {
    body = body.replace(/^(?:html|body|:root)/, scope)
    return `${leading}${body}${trailing}`
  }

  return `${leading}${scope} ${body}${trailing}`
}

function scopeSelectorPrelude(prelude: string, scope: string): string {
  return splitSelectorList(prelude)
    .map(selector => scopeSingleSelector(selector, scope))
    .join(',')
}

function scopeCssBlock(css: string, scope: string): string {
  let out = ''
  let cursor = 0

  while (cursor < css.length) {
    const semicolon = findNextTopLevelSemicolon(css, cursor)
    if (semicolon !== -1) {
      out += css.slice(cursor, semicolon + 1)
      cursor = semicolon + 1
      continue
    }

    const open = findNextRuleOpen(css, cursor)
    if (open === -1) {
      out += css.slice(cursor)
      break
    }

    const close = findRuleClose(css, open)
    if (close === -1) {
      out += css.slice(cursor)
      break
    }

    const prelude = css.slice(cursor, open)
    const block = css.slice(open + 1, close)
    const atRule = prelude.trim().match(/^@([-\w]+)/)?.[1]?.toLowerCase()

    if (atRule) {
      const scopedBlock = SCOPED_GROUP_AT_RULES.has(atRule)
        ? scopeCssBlock(block, scope)
        : block
      out += `${prelude}{${scopedBlock}}`
    } else {
      out += `${scopeSelectorPrelude(prelude, scope)}{${block}}`
    }

    cursor = close + 1
  }

  return out
}

export function scopeSpaceCssForHost(spaceId: string, css: string): string {
  return scopeCssBlock(css, spaceScopeSelector(spaceId))
}

function cssStringEscape(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

export function rewriteRelativeCssUrls(
  css: string,
  cssPath: string,
  toAssetUrl: (path: string) => string,
): string {
  // `cssPath` may be an absolute fs path (dev dirs) or a bundle-relative entry
  // (installed ZIPs, e.g. "style.css" with no slash). Guard the no-slash case
  // so baseDir doesn't truncate the filename.
  const slash = cssPath.lastIndexOf('/')
  const baseDir = slash >= 0 ? cssPath.slice(0, slash) : ''
  return css.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g, (full, _quote: string, rawUrl: string) => {
    const url = rawUrl.trim()
    if (
      !url ||
      url.startsWith('#') ||
      url.startsWith('data:') ||
      url.startsWith('blob:') ||
      url.startsWith('http:') ||
      url.startsWith('https:') ||
      url.startsWith('asset:') ||
      url.startsWith('space:')
    ) {
      return full
    }

    const path = url.startsWith('/') ? url : baseDir ? `${baseDir}/${url}` : url
    return `url("${cssStringEscape(toAssetUrl(path))}")`
  })
}
