/**
 * Reference parsing utilities for the AI Assistant.
 *
 * Parses @design, #task, ~component, $file, !file, and ^doc references
 * from user messages. Pure functions — no Vue reactivity or side effects.
 */
import type { ProjectFile } from '~/types/assistant'

export interface FileReference {
  filename: string      // File name or partial path
  raw: string           // Original matched text
}

export interface DocReference {
  title: string         // Document title or partial match
  raw: string           // Original matched text
}

export interface ParsedReferences {
  docs: DocReference[]        // ^DocTitle references
  tasks: string[]
  components: string[]        // ~ComponentName
  files: string[]             // $path/to/file (explicit paths)
  codeFiles: FileReference[]  // !filename (fuzzy file search like CMD+P)
}

/**
 * Parse @design, #task, ~component, $file, and !file references from message text.
 * Supports: @DesignName, @DesignName/VariantPage, #123, ~ComponentName, $src/file.ts, !login.vue
 */
export function parseReferences(text: string): ParsedReferences {
  // #123 - Task references
  const tasks = [...text.matchAll(/#(\d+)/g)].map(m => m[1]).filter((t): t is string => !!t)

  // ~ComponentName - Component references
  const components = [...text.matchAll(/~([\w-]+)/g)].map(m => m[1]).filter((c): c is string => !!c)

  // $path/to/file - Explicit file path references
  const files = [...text.matchAll(/\$([\w./-]+)/g)].map(m => m[1]).filter((f): f is string => !!f)

  // !filename - Fuzzy file search (like VS Code CMD+P)
  const codeFileMatches = [...text.matchAll(/!([\w.-]+(?:\/[\w.-]+)*)/g)]
  const codeFiles: FileReference[] = codeFileMatches.map(m => ({
    filename: m[1] || '',
    raw: m[0] || '',
  }))

  // ^DocTitle - Document references
  const docMatches = [...text.matchAll(/\^([\w][\w\s-]*?)(?=\s*[,.|!?]|\s+[^\w]|$)/g)]
  const docs: DocReference[] = docMatches.map(m => ({
    title: m[1]?.trim() || '',
    raw: m[1]?.trim() || '',
  }))

  return { docs, tasks, components, files, codeFiles }
}

/** Build context string from referenced components */
export function getReferencedComponentsContext(components: string[]): string {
  if (components.length === 0) return ''
  // TODO: Implement component lookup from code space
  return `\n\n## Referenced Components\nComponents referenced: ${components.map(c => `~${c}`).join(', ')}`
}

/** Build context string from referenced file paths */
export function getReferencedFilesContext(files: string[]): string {
  if (files.length === 0) return ''
  // TODO: Implement file content lookup for $path references
  return `\n\n## Referenced Files\nFiles referenced: ${files.map(f => `$${f}`).join(', ')}`
}

/** Build context string from fuzzy file references (!filename) */
export function getReferencedCodeFilesContext(refs: FileReference[], allFiles: ProjectFile[]): string {
  if (refs.length === 0 || allFiles.length === 0) return ''

  const matchedFiles: string[] = []

  for (const ref of refs) {
    const query = ref.filename.toLowerCase()
    const matches = allFiles.filter(f =>
      f.name.toLowerCase().includes(query)
      || f.path.toLowerCase().includes(query),
    )
    matchedFiles.push(...matches.slice(0, 3).map(f => f.path))
  }

  if (matchedFiles.length === 0) return ''

  return `\n\n## Referenced Code Files (via ! search)\nMatched files: ${matchedFiles.join(', ')}\n\nUse the read_file or file_search tools to access these files if needed.`
}

/** Format tool name for display (snake_case -> Title Case with label) */
export function formatToolName(name: string): string {
  const toolLabels: Record<string, string> = {
    'read_file': 'Reading file',
    'write_file': 'Writing file',
    'create_file': 'Creating file',
    'edit_file': 'Editing file',
    'list_files': 'Listing files',
    'file_search': 'Searching files',
    'search_code': 'Searching code',
    'run_command': 'Running command',
    'create_task': 'Creating task',
    'update_task': 'Updating task',
    'list_tasks': 'Listing tasks',
    'create_project': 'Creating project',
    'list_projects': 'Listing projects',
    'list_users': 'Listing users',
    'invite_user': 'Inviting user',
    'search_users': 'Searching users',
    'create_screen': 'Creating screen',
    'create_element': 'Creating element',
    'search_images': 'Searching images',
    'search_icons': 'Searching icons',
    'git_status': 'Git status',
    'git_diff': 'Git diff',
    'git_commit': 'Git commit',
    'get_current_time': 'Getting time',
    'execute_code': 'Executing code',
  }
  return toolLabels[name] || name.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())
}

/** Format tool result for display (truncate if too long) */
export function formatToolResult(result: string): string {
  try {
    const parsed = JSON.parse(result)
    const formatted = JSON.stringify(parsed, null, 2)
    if (formatted.length > 500) {
      return formatted.substring(0, 500) + '\n... (truncated)'
    }
    return formatted
  } catch {
    if (result.length > 500) {
      return result.substring(0, 500) + '\n... (truncated)'
    }
    return result
  }
}
