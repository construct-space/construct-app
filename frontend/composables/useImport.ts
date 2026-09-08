/**
 * useImport — parse csv / tsv / json / markdown / xlsx into row objects.
 *
 * Hand-rolled csv/tsv parser (RFC-4180 quoted fields supported), JSON.parse
 * for json, pipe-table parser for markdown. xlsx is unsupported in the host
 * (no SheetJS dependency) — throws an install hint. Format auto-detected
 * from the File's name/extension when omitted.
 */

import type { DataFormat, DataFormatInfo, ImportOptions } from '@construct-space/sdk'

const FORMATS: DataFormatInfo[] = [
  { format: 'csv', label: 'CSV', extension: 'csv', mimeType: 'text/csv', kind: 'text' },
  { format: 'tsv', label: 'TSV', extension: 'tsv', mimeType: 'text/tab-separated-values', kind: 'text' },
  { format: 'json', label: 'JSON', extension: 'json', mimeType: 'application/json', kind: 'text' },
  {
    format: 'xlsx',
    label: 'Excel',
    extension: 'xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    kind: 'binary',
  },
  { format: 'markdown', label: 'Markdown', extension: 'md', mimeType: 'text/markdown', kind: 'text' },
]

function detectFromFilename(name: string): DataFormat | null {
  const ext = name.toLowerCase().split('.').pop() || ''
  if (ext === 'csv') return 'csv'
  if (ext === 'tsv') return 'tsv'
  if (ext === 'json') return 'json'
  if (ext === 'md' || ext === 'markdown') return 'markdown'
  if (ext === 'xlsx') return 'xlsx'
  return null
}

function parseDelimited(
  text: string,
  delim: string,
  opts: ImportOptions,
): Array<Record<string, unknown>> {
  const header = opts.header !== false
  const trim = opts.trim === true
  const dyn = opts.dynamicTyping === true
  const skipEmpty = opts.skipEmpty !== false
  const rows: string[][] = []
  let cur: string[] = []
  let field = ''
  let inQuotes = false
  let i = 0
  while (i < text.length) {
    const ch = text[i]!
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue }
        inQuotes = false; i++; continue
      }
      field += ch; i++; continue
    }
    if (ch === '"') { inQuotes = true; i++; continue }
    if (ch === delim) { cur.push(field); field = ''; i++; continue }
    if (ch === '\r') {
      cur.push(field); rows.push(cur); cur = []; field = ''
      if (text[i + 1] === '\n') i += 2; else i++
      continue
    }
    if (ch === '\n') {
      cur.push(field); rows.push(cur); cur = []; field = ''; i++; continue
    }
    field += ch; i++
  }
  if (field.length > 0 || cur.length > 0) { cur.push(field); rows.push(cur) }

  const coerce = (v: string): unknown => {
    const s = trim ? v.trim() : v
    if (!dyn) return s
    if (s === '') return ''
    if (s === 'true') return true
    if (s === 'false') return false
    if (s === 'null') return null
    if (!isNaN(Number(s)) && s.trim() !== '') return Number(s)
    return s
  }

  const filtered = skipEmpty ? rows.filter((r) => r.some((c) => c !== '')) : rows
  if (filtered.length === 0) return []

  let headers: string[]
  let body: string[][]
  if (header) {
    headers = (filtered[0] as string[]).map((h) => (trim ? h.trim() : h))
    body = filtered.slice(1)
  } else {
    headers = (filtered[0] as string[]).map((_, idx) => `col${idx}`)
    body = filtered
  }

  return body.map((row) => {
    const obj: Record<string, unknown> = {}
    headers.forEach((h, idx) => { obj[h] = coerce(row[idx] ?? '') })
    return obj
  })
}

function parseMarkdownTable(text: string, opts: ImportOptions): Array<Record<string, unknown>> {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().startsWith('|'))
  if (lines.length < 2) return []
  const splitRow = (line: string) =>
    line.replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim())
  const headers = splitRow(lines[0]!)
  // lines[1] is the --- separator; skip it.
  const body = lines.slice(2).map(splitRow)
  const dyn = opts.dynamicTyping === true
  const coerce = (s: string): unknown => {
    if (!dyn) return s
    if (s === 'true') return true
    if (s === 'false') return false
    if (s === 'null') return null
    if (s !== '' && !isNaN(Number(s))) return Number(s)
    return s
  }
  return body.map((row) => {
    const obj: Record<string, unknown> = {}
    headers.forEach((h, idx) => { obj[h] = coerce(row[idx] ?? '') })
    return obj
  })
}

async function readAsText(input: string | File | Blob): Promise<string> {
  if (typeof input === 'string') return input
  return await input.text()
}

export function useImport() {
  async function parse<T = Record<string, unknown>>(
    input: string | File | Blob,
    opts: ImportOptions = {},
  ): Promise<T[]> {
    let format = opts.format
    if (!format) {
      if (typeof input !== 'string' && 'name' in input && typeof input.name === 'string') {
        format = detectFromFilename(input.name) || undefined
      }
    }
    if (!format) format = 'csv'

    if (format === 'xlsx') {
      throw new Error(
        'useImport: xlsx format requires the optional "xlsx" (SheetJS) package, ' +
        'which is not bundled with the host. Convert your file to csv/tsv or ' +
        'parse it inside your space with XLSX.read() directly.',
      )
    }

    const text = await readAsText(input)
    if (format === 'csv') return parseDelimited(text, opts.delimiter ?? ',', opts) as T[]
    if (format === 'tsv') return parseDelimited(text, opts.delimiter ?? '\t', opts) as T[]
    if (format === 'json') {
      const parsed = JSON.parse(text)
      return (Array.isArray(parsed) ? parsed : [parsed]) as T[]
    }
    if (format === 'markdown') return parseMarkdownTable(text, opts) as T[]
    throw new Error(`useImport: unsupported format "${String(format)}"`)
  }

  return { formats: FORMATS, parse }
}
