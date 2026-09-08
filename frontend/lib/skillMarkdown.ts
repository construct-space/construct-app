const FRONTMATTER_DELIMITER = '---'
const SCALAR_KEYS_TO_QUOTE = new Set(['name', 'description', 'category', 'trigger'])

function needsYamlQuoting(value: string): boolean {
  const trimmed = value.trim()
  if (!trimmed) return false
  if (trimmed.startsWith('"') || trimmed.startsWith("'")) return false
  if (trimmed.startsWith('|') || trimmed.startsWith('>')) return false
  if (trimmed.startsWith('[') || trimmed.startsWith('{')) return false
  return /:\s/.test(trimmed)
}

function quoteYamlString(value: string): string {
  return JSON.stringify(value.trim())
}

/**
 * Normalise common LLM-generated frontmatter mistakes without changing the
 * markdown body. The Go operator uses strict YAML parsing, so unquoted values
 * like `description: Use when: reviewing PRs` fail with "mapping values are
 * not allowed". Quoting only simple scalar fields preserves user intent while
 * making generated skill files saveable.
 */
export function normalizeSkillMarkdown(markdown: string): string {
  const trimmedStart = markdown.trimStart()
  if (!trimmedStart.startsWith(FRONTMATTER_DELIMITER)) return markdown

  const leadingWhitespaceLength = markdown.length - trimmedStart.length
  const leadingWhitespace = markdown.slice(0, leadingWhitespaceLength)
  const withoutOpening = trimmedStart.slice(FRONTMATTER_DELIMITER.length)
  const delimiterIndex = withoutOpening.indexOf(`\n${FRONTMATTER_DELIMITER}`)
  if (delimiterIndex === -1) return markdown

  const frontmatter = withoutOpening.slice(0, delimiterIndex)
  const rest = withoutOpening.slice(delimiterIndex)
  const normalizedFrontmatter = frontmatter
    .split('\n')
    .map((line) => {
      const match = line.match(/^(\s*)([A-Za-z_][A-Za-z0-9_-]*):(\s*)(.*)$/)
      if (!match) return line
      const [, indent, key, spacing, value] = match
      if (!SCALAR_KEYS_TO_QUOTE.has(key) || !needsYamlQuoting(value)) return line
      return `${indent}${key}:${spacing}${quoteYamlString(value)}`
    })
    .join('\n')

  return `${leadingWhitespace}${FRONTMATTER_DELIMITER}${normalizedFrontmatter}${rest}`
}
