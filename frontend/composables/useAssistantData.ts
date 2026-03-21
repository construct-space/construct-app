/**
 * useAssistantData — Project data loading for the AI Assistant.
 *
 * Loads designs, documents, tasks, and project files for autocomplete
 * and system prompt context. Watches project changes and re-fetches.
 *
 * Extracted from AssistantFloat.vue.
 */
import { ref, watch, type Ref } from 'vue'
import type { DocumentListItem, ProjectFile, FileTreeEntry, TaskCacheItem } from '~/types/assistant'
import { requestSpaceData } from '~/lib/spaceContextBus'

// Flatten nested file tree into flat array
interface ContextFileTreeEntry {
  name: string
  type: string
  path?: string
  children?: ContextFileTreeEntry[]
}

const CODE_EXTENSIONS = new Set([
  'vue', 'ts', 'tsx', 'js', 'jsx', 'go', 'py', 'css', 'scss', 'html',
  'json', 'md', 'yaml', 'yml',
])

const CODE_EXTENSIONS_EXTENDED = new Set([
  'vue', 'ts', 'tsx', 'js', 'jsx', 'go', 'py', 'rs', 'dart', 'css', 'scss',
  'less', 'html', 'json', 'yaml', 'yml', 'toml', 'md', 'sql', 'sh', 'bash',
  'zsh', 'swift', 'kt', 'java', 'c', 'cpp', 'h', 'rb', 'php', 'xml', 'svg',
  'env', 'gitignore', 'dockerfile',
])

function flattenFileTree(tree: ContextFileTreeEntry[], files: ProjectFile[], parentPath = '') {
  for (const entry of tree) {
    const fullPath = parentPath ? `${parentPath}/${entry.name}` : entry.name
    if (entry.type === 'file') {
      const ext = entry.name.split('.').pop()?.toLowerCase()
      if (ext && CODE_EXTENSIONS.has(ext)) {
        files.push({ name: entry.name, path: entry.path || fullPath, type: 'file' })
      }
    } else if (entry.type === 'directory' && entry.children) {
      flattenFileTree(entry.children, files, fullPath)
    }
  }
}

/** Flatten code editor's FileEntry tree into ProjectFile[] */
export function flattenCodeEditorTree(entries: FileTreeEntry[], files: ProjectFile[], maxDepth = 5, depth = 0) {
  if (depth > maxDepth) return
  for (const entry of entries) {
    if (!entry.isDirectory) {
      const ext = entry.name.split('.').pop()?.toLowerCase()
      if (ext && CODE_EXTENSIONS_EXTENDED.has(ext)) {
        files.push({ name: entry.name, path: entry.path, type: 'file' })
      }
    } else if (entry.children && Array.isArray(entry.children)) {
      flattenCodeEditorTree(entry.children as typeof entries, files, maxDepth, depth + 1)
    }
  }
}

// Doc helpers
function guessDocType(filename: string): string {
  const nameLower = filename.toLowerCase()
  if (nameLower.includes('prd')) return 'prd'
  if (nameLower.includes('readme')) return 'readme'
  if (nameLower.includes('architect')) return 'architecture'
  if (nameLower.includes('roadmap')) return 'roadmap'
  if (nameLower.includes('setup')) return 'setup'
  return 'custom'
}

export function docTitleToFilename(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') + '.md'
}

export function docFilenameToTitle(filename: string): string {
  return filename.replace(/\.md$/, '').replace(/[-_]/g, ' ').replace(/\b\w/g, l => l.toUpperCase())
}

/** Get file icon based on extension */
export function getFileIcon(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase()
  const icons: Record<string, string> = {
    vue: 'i-logos-vue',
    ts: 'i-logos-typescript-icon',
    tsx: 'i-logos-react',
    js: 'i-logos-javascript',
    jsx: 'i-logos-react',
    go: 'i-logos-go',
    py: 'i-logos-python',
    css: 'i-vscode-icons-file-type-css',
    scss: 'i-vscode-icons-file-type-scss',
    html: 'i-logos-html-5',
    json: 'i-vscode-icons-file-type-json',
    md: 'i-lucide-file-text',
  }
  return icons[ext || ''] || 'i-lucide-file-code'
}

/** Status icons for tasks */
export const taskStatusIcons: Record<string, string> = {
  backlog: 'i-lucide-inbox',
  todo: 'i-lucide-circle',
  in_progress: 'i-lucide-loader',
  review: 'i-lucide-eye',
  done: 'i-lucide-check-circle',
}

/** Priority colors for tasks */
export const taskPriorityColors: Record<string, string> = {
  low: 'text-gray-400',
  medium: 'text-blue-400',
  high: 'text-orange-400',
  urgent: 'text-red-400',
}

interface AssistantDataDeps {
  projectStore: {
    currentProject: { id: string | number; name: string; path: string; local_path?: string; description?: string; spaces?: string[] } | null
  }
  sendRequest: <T = unknown>(method: string, params?: Record<string, unknown>) => Promise<T>
  callTool: (tool: { id: string; type: 'function'; function: { name: string; arguments: string } }) => Promise<{ content?: string; is_error?: boolean } | null>
  connected: Ref<boolean>
  busTasksCache: Ref<TaskCacheItem[]>
  codeEditorState: {
    rootPath: string
    fileTree: FileTreeEntry[]
  }
}

export function useAssistantData(deps: AssistantDataDeps) {
  const { projectStore, callTool, connected, busTasksCache, codeEditorState } = deps

  // Reactive data refs
  const projectDocs = ref<DocumentListItem[]>([])
  const localDocs = ref<{ title: string; path: string; type: string }[]>([])
  const projectFiles = ref<ProjectFile[]>([])

  // Tauri FS for doc sync (lazy loaded)
  let docsTauriFs: typeof import('@tauri-apps/plugin-fs') | null = null
  const initDocsTauri = async () => {
    if (docsTauriFs) return true
    try {
      docsTauriFs = await import('@tauri-apps/plugin-fs')
      return true
    } catch {
      return false
    }
  }

  /** Load project docs from space handler + scan local docs/ folder */
  async function syncProjectDocs(_projectId: string | number, projectPath: string | undefined) {
    try {
      const docs = await requestSpaceData('docs', { type: 'documents.list' })
      if (Array.isArray(docs)) {
        projectDocs.value = (docs as Array<{ title: string; type: string; filename?: string; id?: number }>).map(d => ({
          id: d.id ?? 0,
          title: d.title,
          type: d.type || 'custom',
        })) as DocumentListItem[]
      }
    } catch (e) {
      console.warn('[AssistantData] Failed to load docs from space handler:', e)
    }

    if (!projectPath) return

    const hasTauri = await initDocsTauri()
    if (!hasTauri || !docsTauriFs) return

    const docsPath = `${projectPath}/docs`
    try {
      const exists = await docsTauriFs.exists(docsPath)
      if (!exists) return
    } catch { return }

    const scannedLocal: { title: string; path: string; type: string }[] = []
    try {
      const entries = await docsTauriFs.readDir(docsPath)
      for (const entry of entries) {
        if (entry.name && entry.name.endsWith('.md')) {
          scannedLocal.push({
            title: docFilenameToTitle(entry.name),
            path: `${docsPath}/${entry.name}`,
            type: guessDocType(entry.name),
          })
        }
      }
    } catch (e) {
      console.debug('[AssistantData] Could not read docs directory:', e)
    }

    localDocs.value = scannedLocal

    const spaceTitles = new Set(projectDocs.value.map(d => d.title.toLowerCase()))
    for (const local of scannedLocal) {
      if (!spaceTitles.has(local.title.toLowerCase())) {
        projectDocs.value.push({ id: 0, title: local.title, type: local.type } as DocumentListItem)
      }
    }
  }

  /** Load project files recursively (limited depth for performance) */
  async function loadProjectFiles(rootPath: string, maxDepth = 4): Promise<ProjectFile[]> {
    const files: ProjectFile[] = []
    try {
      const result = await callTool({
        id: `tool-${Date.now()}`,
        type: 'function',
        function: {
          name: 'get_file_tree',
          arguments: JSON.stringify({ path: rootPath, max_depth: maxDepth }),
        },
      })
      if (result?.is_error) return []
      const parsed = JSON.parse(result?.content || '{}') as { tree?: unknown }
      if (parsed?.tree && Array.isArray(parsed.tree)) {
        flattenFileTree(parsed.tree as ContextFileTreeEntry[], files)
      }
    } catch (e) {
      console.debug('[AssistantData] Could not load file tree from', rootPath, e)
    }
    return files
  }

  // Watch project changes to load data
  watch(
    () => projectStore.currentProject?.id,
    async (projectId) => {
      if (projectId) {
        // Load tasks
        if (busTasksCache.value.length === 0) {
          try {
            const tasks = await requestSpaceData('kanban', { type: 'tasks.fetchProject', params: { projectId } })
            if (Array.isArray(tasks)) busTasksCache.value = tasks
          } catch (e) {
            console.warn('[AssistantData] Failed to load tasks:', e)
          }
        }

        // Sync docs
        try {
          const project = projectStore.currentProject
          await syncProjectDocs(projectId, project?.local_path)
        } catch (e) {
          console.warn('[AssistantData] Failed to sync docs:', e)
        }

        // Load project files
        try {
          const project = projectStore.currentProject
          if (connected.value) {
            const candidateRoots = [
              codeEditorState.rootPath,
              project?.local_path,
              project?.local_path ? `${project.local_path}/code` : undefined,
            ].filter((p): p is string => !!p && p.trim().length > 0)

            let bestFiles: ProjectFile[] = []
            for (const root of candidateRoots) {
              const files = await loadProjectFiles(root)
              if (files.length > bestFiles.length) {
                bestFiles = files
              }
            }
            projectFiles.value = bestFiles
          }
        } catch (e) {
          console.warn('[AssistantData] Failed to load project files:', e)
        }
      } else {
        projectDocs.value = []
        localDocs.value = []
        projectFiles.value = []
      }
    },
    { immediate: true },
  )

  // Sync project files from code editor's file tree
  watch(
    () => codeEditorState.fileTree,
    (tree) => {
      if (tree && tree.length > 0) {
        const files: ProjectFile[] = []
        flattenCodeEditorTree(tree, files)
        projectFiles.value = files
      }
    },
    { immediate: true, deep: true },
  )

  // If code root path changes, refresh ! autocomplete files
  watch(
    () => codeEditorState.rootPath,
    async (root) => {
      if (!root || !connected.value) return
      if (projectFiles.value.length > 0) return
      const files = await loadProjectFiles(root)
      if (files.length > 0) projectFiles.value = files
    },
    { immediate: true },
  )

  return {
    projectDocs,
    localDocs,
    projectFiles,
    docsTauriFs: () => docsTauriFs,
    loadProjectFiles,
    syncProjectDocs,
  }
}
