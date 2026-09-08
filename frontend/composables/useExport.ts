/**
 * useExport — serialize row objects into csv / tsv / json / markdown / xlsx.
 *
 * Hand-rolled csv/tsv (no library), JSON.stringify for json, pipe-table
 * for markdown. xlsx is unsupported (no SheetJS dependency in the host) —
 * the `generate` call throws a clear install hint. `save()` pipes through
 * useDownload().save() with the format's extension appended automatically.
 */

import type { DataFormat, DataFormatInfo, ExportOptions } from '@construct-space/sdk'
import { useDownload } from '@/composables/useDownload'

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

type ColumnSpec = { key: string; label?: string }

function resolveColumns(
  rows: Array<Record<string, unknown>>,
  cols?: ExportOptions['columns'],
): ColumnSpec[] {
  if (cols && cols.length > 0) {
    return cols.map((c) => (typeof c === 'string' ? { key: c } : c))
  }
  if (rows.length === 0) return []
  return Object.keys(rows[0]!).map((k) => ({ key: k }))
}

function csvEscape(value: unknown, delim: string): string {
  if (value == null) return ''
  const s = String(value)
  if (s.includes(delim) || s.includes('"') || s.includes('\n') || s.includes('\r')) {
    return `"${s.replace(/"/g, '""')}"`
  }
  return s
}

function generateDelimited(
  rows: Array<Record<string, unknown>>,
  cols: ColumnSpec[],
  delim: string,
  newline: string,
  header: boolean,
): string {
  const lines: string[] = []
  if (header) {
    lines.push(cols.map((c) => csvEscape(c.label ?? c.key, delim)).join(delim))
  }
  for (const row of rows) {
    lines.push(cols.map((c) => csvEscape(row[c.key], delim)).join(delim))
  }
  return lines.join(newline)
}

function generateMarkdown(
  rows: Array<Record<string, unknown>>,
  cols: ColumnSpec[],
  header: boolean,
): string {
  const esc = (v: unknown) => String(v ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ')
  const lines: string[] = []
  if (header) {
    lines.push(`| ${cols.map((c) => esc(c.label ?? c.key)).join(' | ')} |`)
    lines.push(`| ${cols.map(() => '---').join(' | ')} |`)
  }
  for (const row of rows) {
    lines.push(`| ${cols.map((c) => esc(row[c.key])).join(' | ')} |`)
  }
  return lines.join('\n')
}

export function useExport() {
  async function generate(
    rows: Array<Record<string, unknown>>,
    opts: ExportOptions,
  ): Promise<string | Blob> {
    const cols = resolveColumns(rows, opts.columns)
    const header = opts.header !== false
    const newline = opts.newline ?? '\r\n'
    const format: DataFormat = opts.format

    if (format === 'csv') {
      return generateDelimited(rows, cols, opts.delimiter ?? ',', newline, header)
    }
    if (format === 'tsv') {
      return generateDelimited(rows, cols, opts.delimiter ?? '\t', newline, header)
    }
    if (format === 'json') {
      return JSON.stringify(rows, null, opts.pretty ? 2 : 0)
    }
    if (format === 'markdown') {
      return generateMarkdown(rows, cols, header)
    }
    if (format === 'xlsx') {
      throw new Error(
        'useExport: xlsx format requires the optional "xlsx" (SheetJS) package, ' +
        'which is not bundled with the host. Install it in your space and call ' +
        'XLSX.write() directly, or export to csv/tsv instead.',
      )
    }
    throw new Error(`useExport: unsupported format "${String(format)}"`)
  }

  async function save(
    rows: Array<Record<string, unknown>>,
    opts: ExportOptions & { filename: string },
  ): Promise<void> {
    const out = await generate(rows, opts)
    const info = FORMATS.find((f) => f.format === opts.format)!
    let filename = opts.filename
    if (!filename.toLowerCase().endsWith(`.${info.extension}`)) {
      filename = `${filename}.${info.extension}`
    }
    await useDownload().save(out, { filename, contentType: info.mimeType })
  }

  return { formats: FORMATS, generate, save }
}
