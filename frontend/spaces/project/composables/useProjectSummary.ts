/**
 * useProjectSummary - Loads summary counts for a project's spaces
 *
 * Fetches docs, designs, files, and git status directly from the operator
 * so the project detail page can show what's inside without navigating
 * into each space.
 */
import { ref, watch, type Ref } from 'vue'
import { useBrain } from '@/brain'

export interface FileEntry {
  name: string
  type: 'file' | 'directory'
}

export interface ProjectSummary {
  docs: { count: number; items: { title: string; filename?: string; type?: string }[] }
  files: { count: number; languages: { ext: string; count: number }[] }
  fileTree: FileEntry[]
  git: { hasRepo: boolean; branch?: string }
  readme: string
  loading: boolean
}

function emptyStats(): ProjectSummary {
  return {
    docs: { count: 0, items: [] },
    files: { count: 0, languages: [] },
    fileTree: [],
    git: { hasRepo: false },
    readme: '',
    loading: false,
  }
}

export function useProjectSummary(projectPath: Ref<string | undefined>) {
  const summary = ref<ProjectSummary>(emptyStats())
  const brain = useBrain()

  async function callOperatorTool(name: string, args: Record<string, unknown>): Promise<string | null> {
    try {
      const result = await brain.callTool({
        id: `summary-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        type: 'function',
        function: {
          name,
          arguments: JSON.stringify(args),
        },
      })
      if (result?.is_error) return null
      return result?.content ?? null
    } catch {
      return null
    }
  }

  // Recognises the operator's list_dir dedup sentinel — the one-line
  // "[Dir listing unchanged — already shown Nx this session. …]" reply
  // it returns when the same path is scanned repeatedly. Callers must
  // check this BEFORE parsing so they can preserve their prior state
  // instead of overwriting it with an empty list.
  function isListDirDedup(content: string): boolean {
    return content.startsWith('[Dir listing unchanged')
  }

  // Parse list_dir plain text output: "📁 dirname" or "  filename"
  function parseListDir(content: string): FileEntry[] {
    if (isListDirDedup(content)) return []
    return content.split('\n')
      .map(line => line.trimEnd())
      .filter(line => line.length > 0)
      .map(line => {
        const isDir = line.startsWith('📁')
        const name = line.replace(/^📁\s*/, '').replace(/^\s+/, '').trim()
        return { name, type: isDir ? 'directory' as const : 'file' as const }
      })
      .filter(e => e.name.length > 0)
  }

  async function loadDocs(path: string) {
    const content = await callOperatorTool('list_dir', { path: `${path}/docs` })
    if (!content) {
      // Try .construct/docs as fallback
      const fallback = await callOperatorTool('list_dir', { path: `${path}/.construct/docs` })
      if (!fallback || isListDirDedup(fallback)) return
      parseDocs(fallback)
      return
    }
    if (isListDirDedup(content)) return // keep previously loaded docs
    parseDocs(content)
  }

  function parseDocs(content: string) {
    const entries = parseListDir(content)
    const docs = entries.filter(e => e.name.endsWith('.md') && e.type === 'file')
    summary.value.docs = {
      count: docs.length,
      items: docs.slice(0, 8).map(d => ({
        title: d.name.replace(/\.md$/, '').replace(/[-_]/g, ' '),
        filename: d.name,
        type: 'markdown',
      })),
    }
  }

  async function loadFiles(path: string) {
    const content = await callOperatorTool('list_dir', { path })
    if (!content || isListDirDedup(content)) return // preserve prior files summary
    const entries = parseListDir(content)
    const files = entries.filter(e => e.type === 'file')
    const extCounts: Record<string, number> = {}
    for (const f of files) {
      const ext = f.name.split('.').pop()?.toLowerCase() || ''
      if (ext && ext !== f.name) {
        extCounts[ext] = (extCounts[ext] || 0) + 1
      }
    }
    const languages = Object.entries(extCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([ext, count]) => ({ ext, count }))
    summary.value.files = { count: files.length, languages }
  }

  async function loadGit(path: string) {
    // Check if .git exists
    const content = await callOperatorTool('path_exists', { path: `${path}/.git` })
    if (!content) return
    try {
      const parsed = JSON.parse(content)
      if (parsed?.exists) {
        summary.value.git = { hasRepo: true }
        // Try to get current branch
        const branchContent = await callOperatorTool('run_command', {
          command: 'git rev-parse --abbrev-ref HEAD',
          working_directory: path,
        })
        if (branchContent) {
          try {
            const branchParsed = JSON.parse(branchContent)
            const branch = (branchParsed?.output || branchParsed?.stdout || '').trim()
            if (branch) {
              summary.value.git = { hasRepo: true, branch }
            }
          } catch { /* ignore */ }
        }
      }
    } catch { /* ignore */ }
  }

  async function loadFileTree(path: string) {
    const content = await callOperatorTool('list_dir', { path })
    // Preserve the previous fileTree on dedup so projectType's space
    // detection (hasSpaceDir check) keeps working across re-mounts.
    if (!content || isListDirDedup(content)) return
    const entries = parseListDir(content)
      .filter(e => !e.name.startsWith('.'))
      .sort((a, b) => {
        if (a.type === b.type) return a.name.localeCompare(b.name)
        return a.type === 'directory' ? -1 : 1
      })
    summary.value.fileTree = entries
  }

  // Read a candidate path and, if it's a usable README (non-empty,
  // not a tool cache miss), write it into summary.readme. Returns true
  // on success so the caller can short-circuit.
  async function tryReadme(candidate: string): Promise<boolean> {
    const content = await callOperatorTool('read_file', { path: candidate })
    if (!content) return false
    if (content.includes('[File unchanged since last read')) return false
    let text = content
    try {
      const parsed = JSON.parse(content)
      text = parsed?.content || parsed || content
    } catch { /* raw text */ }
    const cleaned = String(text).replace(/^\s*\d+[│|]\s?/gm, '')
    if (cleaned.trim().length < 5) return false
    summary.value.readme = cleaned
    return true
  }

  async function loadReadme(path: string) {
    // Common spellings at the project root first. Case variants matter
    // on case-sensitive filesystems (most Linux); macOS catches any
    // casing via the first match. The extension-less README covers Go
    // and Rust style.
    const rootCandidates = [
      `${path}/README.md`,
      `${path}/readme.md`,
      `${path}/Readme.md`,
      `${path}/README.markdown`,
      `${path}/README`,
      `${path}/readme`,
      `${path}/docs/README.md`,
      `${path}/docs/readme.md`,
      `${path}/docs/Readme.md`,
    ]
    for (const candidate of rootCandidates) {
      if (await tryReadme(candidate)) return
    }

    // Nothing at the root — fall through to space-*/ subdirs. Project-
    // scope space layouts (e.g. `<project>/space-flipper/README.md`) are
    // where the real README usually lives for Space Developer-scaffolded
    // projects. First subdir that has one wins; good enough until we
    // support multi-space projects explicitly in the detail page.
    const listing = await callOperatorTool('list_dir', { path })
    if (!listing) return
    const spaceSubdirs = parseListDir(listing)
      .filter(e => e.type === 'directory' && e.name.startsWith('space-'))
      .map(e => e.name)
    for (const dir of spaceSubdirs) {
      const base = `${path}/${dir}`
      for (const name of ['README.md', 'readme.md', 'Readme.md', 'README']) {
        if (await tryReadme(`${base}/${name}`)) return
      }
    }
  }

  async function loadAll() {
    const path = projectPath.value
    if (!path) return

    summary.value = { ...emptyStats(), loading: true }

    // Run all fetches in parallel
    await Promise.allSettled([
      loadDocs(path),
      loadFiles(path),
      loadFileTree(path),
      loadGit(path),
      loadReadme(path),
    ])

    summary.value.loading = false
  }

  // Reload when project changes
  watch(projectPath, (newPath) => {
    if (newPath) loadAll()
    else summary.value = emptyStats()
  }, { immediate: true })

  return { summary, refresh: loadAll }
}
