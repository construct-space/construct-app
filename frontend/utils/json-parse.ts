/**
 * JSON parsing utilities for extracting structured data from AI responses.
 * Handles markdown code fences, think tags, and nested JSON.
 */

export function extractJson(content: string): string {
  return content
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/```(?:json)?\s*\n?/g, '')
    .replace(/\n?\s*```/g, '')
    .trim()
}

export function findFirstJsonArray(text: string): string | null {
  for (let start = 0; start < text.length; start++) {
    if (text[start] !== '[') continue
    let depth = 0, inString = false, escaped = false
    for (let i = start; i < text.length; i++) {
      const ch = text[i]
      if (inString) {
        if (escaped) { escaped = false } else if (ch === '\\') { escaped = true } else if (ch === '"') { inString = false }
        continue
      }
      if (ch === '"') { inString = true } else if (ch === '[') { depth++ } else if (ch === ']') {
        depth--
        if (depth === 0) {
          const candidate = text.slice(start, i + 1)
          try { JSON.parse(candidate); return candidate } catch { break }
        }
      }
    }
  }
  return null
}

export function findFirstJsonObject(text: string): string | null {
  for (let start = 0; start < text.length; start++) {
    if (text[start] !== '{') continue
    let depth = 0, inString = false, escaped = false
    for (let i = start; i < text.length; i++) {
      const ch = text[i]
      if (inString) {
        if (escaped) { escaped = false } else if (ch === '\\') { escaped = true } else if (ch === '"') { inString = false }
        continue
      }
      if (ch === '"') { inString = true } else if (ch === '{') { depth++ } else if (ch === '}') {
        depth--
        if (depth === 0) return text.slice(start, i + 1)
      }
    }
  }
  return null
}

export function parseJsonArray<T = unknown>(content: string): T[] {
  try {
    const cleaned = extractJson(content)
    if (cleaned.startsWith('[')) return JSON.parse(cleaned)
    if (cleaned.startsWith('{')) {
      const obj = JSON.parse(cleaned)
      const candidate = obj.questions || obj.data || obj.message
      if (Array.isArray(candidate)) return candidate
    }
    const match = findFirstJsonArray(cleaned)
    if (match) return JSON.parse(match)
  } catch (e) {
    console.error('[json-parse] Failed to parse array:', e)
  }
  return []
}

export function parseJsonObject(content: string): Record<string, unknown> | null {
  try {
    const cleaned = extractJson(content)
    if (cleaned.startsWith('{')) return JSON.parse(cleaned)
    const match = findFirstJsonObject(cleaned)
    if (match) return JSON.parse(match)
  } catch (e) {
    console.error('[json-parse] Failed to parse object:', e)
  }
  return null
}
