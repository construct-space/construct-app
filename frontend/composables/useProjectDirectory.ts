/**
 * Project Directory Management
 * Handles local filesystem project structure
 */
import { invoke } from '@tauri-apps/api/core'
import { IS_DEV_INSTANCE } from '@/lib/appPaths'

export interface ProjectConfig {
  version: 1
  name: string
  description?: string
  local_path: string       // Absolute path to project directory
  created: string
  updated: string
  repos: Array<{
    name: string
    path: string           // Relative to project/code/
    origin?: string        // Git remote URL
  }>
  spaces: string[]         // Enabled spaces: ['code', 'design', 'git', etc.]
}

export interface ProjectDirectoryEntry {
  name: string
  path: string
  isDirectory: boolean
  children?: ProjectDirectoryEntry[]
  isRepo?: boolean         // Has .git folder
  repoStatus?: 'clean' | 'dirty' | 'unknown'
  branch?: string          // Current git branch
}

interface ProjectDirectoryState {
  projectsRoot: string
  currentProjectPath: string
  currentConfig: ProjectConfig | null
  isInitialized: boolean
}

// Module-level state (shared across all useProjectDirectory calls)
const state = reactive<ProjectDirectoryState>({
  projectsRoot: '',
  currentProjectPath: '',
  currentConfig: null,
  isInitialized: false,
})

// Track previous local_path to detect changes
let previousLocalPath: string | null = null

// Module-level Tauri APIs
let tauriFs: typeof import('@tauri-apps/plugin-fs') | null = null
let tauriDialog: typeof import('@tauri-apps/plugin-dialog') | null = null
let tauriPath: typeof import('@tauri-apps/api/path') | null = null

// Storage key for projects root preference
const PROJECTS_ROOT_KEY = 'construct_projects_root'

const normalizePath = (value: string): string => {
  if (!value) return value
  if (value === '/') return value
  return value.replace(/\/+$/g, '')
}

// Shell command helper that bypasses fs:scope restrictions
const runShellCommand = async (cmd: string, args: string[], cwd: string): Promise<{ success: boolean; output: string }> => {
  try {
    const result = await invoke<{ success: boolean; code: number | null; stdout: string; stderr: string }>('run_shell_command', {
      command: cmd,
      args,
      cwd
    })
    return { success: result.success, output: result.success ? result.stdout : result.stderr }
  } catch (e) {
    console.error('Shell command error:', e)
    return { success: false, output: String(e) }
  }
}

export function useProjectDirectory() {
  // Get project store (may be null if called before app setup)
  const projectStore = typeof useProjectStore === 'function' ? useProjectStore() : null

  /**
   * Global computed for current project's local path
   * This is the source of truth for the project's local directory
   */
  const projectLocalPath = computed(() => {
    return projectStore?.currentProject?.local_path || ''
  })

  /**
   * Resolve a relative path from the project root
   * @param relativePath - Path relative to project root (e.g., 'code/my-repo')
   * @returns Absolute path or empty string if no project path
   */
  const resolveProjectPath = (relativePath: string): string => {
    const basePath = normalizePath(projectLocalPath.value)
    if (!basePath) return ''
    // Normalize: remove leading slash from relative path
    const normalized = relativePath.replace(/^\/+/, '')
    return `${basePath}/${normalized}`
  }

  /**
   * Get path to a specific space directory
   * @param spaceName - Name of the space (code, design, assets, etc.)
   */
  const getSpacePath = (spaceName: string): string => {
    return resolveProjectPath(spaceName)
  }

  /**
   * Check if path is within the current project directory
   * Security helper to prevent path traversal
   */
  const isWithinProject = (targetPath: string): boolean => {
    const basePath = projectLocalPath.value
    if (!basePath || !targetPath) return false

    const normalizedTarget = normalizePath(targetPath.replace(/\/+/g, '/'))
    const normalizedBase = normalizePath(basePath.replace(/\/+/g, '/'))

    if (!normalizedTarget.startsWith(normalizedBase + '/') && normalizedTarget !== normalizedBase) {
      return false
    }

    if (normalizedTarget.includes('/../') || normalizedTarget.endsWith('/..')) {
      return false
    }

    return true
  }

  /**
   * Initialize Tauri APIs
   */
  const initTauri = async () => {
    if (typeof window === 'undefined') return false

    try {
      if (!tauriFs) {
        tauriFs = await import('@tauri-apps/plugin-fs')
      }
      if (!tauriDialog) {
        tauriDialog = await import('@tauri-apps/plugin-dialog')
      }
      if (!tauriPath) {
        tauriPath = await import('@tauri-apps/api/path')
      }
      state.isInitialized = true
      return true
    } catch (e) {
      console.warn('Tauri APIs not available:', e)
      return false
    }
  }

  /**
   * Get the projects root directory
   * If not set, prompts user to choose
   */
  const getProjectsRoot = async (): Promise<string> => {
    // Check if already set in state
    if (state.projectsRoot) {
      return state.projectsRoot
    }

    // Check localStorage for saved preference
    const savedRoot = localStorage.getItem(PROJECTS_ROOT_KEY)
    if (savedRoot) {
      const normalizedSavedRoot = normalizePath(savedRoot)
      // Verify the directory still exists
      try {
        await initTauri()
        if (tauriFs) {
          const exists = await tauriFs.exists(normalizedSavedRoot)
          if (exists) {
            state.projectsRoot = normalizedSavedRoot
            return normalizedSavedRoot
          }
        }
      } catch (e) {
        console.warn('Saved projects root no longer exists:', e)
      }
    }

    // Need to ask user - return empty string (caller should prompt)
    return ''
  }

  /**
   * Set the projects root directory
   */
  const setProjectsRoot = async (path: string): Promise<boolean> => {
    const normalizedPath = normalizePath(path)
    console.log('setProjectsRoot called with:', normalizedPath)

    try {
      // Create directory if it doesn't exist using shell command
      console.log('Creating projects root directory:', normalizedPath)
      const mkdirResult = await runShellCommand('mkdir', ['-p', normalizedPath], '/')
      if (!mkdirResult.success) {
        console.error('Failed to create projects root:', mkdirResult.output)
        return false
      }
      console.log('Projects root directory ready')

      state.projectsRoot = normalizedPath
      localStorage.setItem(PROJECTS_ROOT_KEY, normalizedPath)
      return true
    } catch (e) {
      console.error('Failed to set projects root:', e)
      return false
    }
  }

  /**
   * Prompt user to select projects root directory
   */
  const promptForProjectsRoot = async (): Promise<string | null> => {
    await initTauri()
    if (!tauriDialog || !tauriPath) return null

    try {
      // Get home directory as default
      const homeDir = await tauriPath.homeDir()

      const selected = await tauriDialog.open({
        directory: true,
        multiple: false,
        defaultPath: homeDir,
        title: 'Choose Projects Folder',
      })

      if (selected && typeof selected === 'string') {
        await setProjectsRoot(selected)
        return selected
      }

      // If user cancelled, offer to create default
      return null
    } catch (e) {
      console.error('Failed to prompt for projects root:', e)
      return null
    }
  }

  /**
   * Create a new project directory structure
   * @param name - Project name
   * @param basePath - Parent directory OR direct project path (if useDirectPath is true)
   * @param spaces - Space directories to create
   * @param useDirectPath - If true, basePath is the project folder; if false, creates basePath/name
   */
  const createProjectStructure = async (
    name: string,
    basePath?: string,
    spaces: string[] = ['code', 'ui', 'assets'],
    useDirectPath: boolean = false
  ): Promise<string | null> => {
    console.log('createProjectStructure called:', { name, basePath, spaces, useDirectPath })
    await initTauri()

    try {
      // Determine project path
      const root = normalizePath(basePath || state.projectsRoot)
      if (!root) {
        console.error('No projects root set and no basePath provided')
        return null
      }

      // If useDirectPath, use basePath directly as project folder
      // Otherwise, create a subfolder with a sanitized directory name
      const dirName = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
      const projectPath = useDirectPath ? root : `${root}/${dirName}`
      console.log('Creating project at:', projectPath)

      // Use shell commands to create directories (bypasses fs:scope restrictions)
      // Create project directory with all subdirectories in one command
      const diskSpaces = spaces.filter(s => s !== 'design')
      const allDirs = [
        projectPath,
        `${projectPath}/.construct`,
        ...diskSpaces.map(s => `${projectPath}/${s}`)
      ]

      console.log('Creating directories:', allDirs)

      // Use mkdir -p to create all directories
      const mkdirResult = await runShellCommand('mkdir', ['-p', ...allDirs], '/')
      if (!mkdirResult.success) {
        console.error('Failed to create directories:', mkdirResult.output)
        throw new Error(`Failed to create directories: ${mkdirResult.output}`)
      }
      console.log('Directories created successfully')

      // Create initial project config using shell command to write file
      const config: ProjectConfig = {
        version: 1,
        name,
        local_path: projectPath,  // Store absolute path in config
        created: new Date().toISOString(),
        updated: new Date().toISOString(),
        repos: [],
        spaces,
      }

      // Write config file using shell
      const configJson = JSON.stringify(config, null, 2)
      const configPath = `${projectPath}/.construct/project.json`

      // Use tee to write file content (works better than echo for JSON)
      const writeResult = await runShellCommand('sh', ['-c', `cat > "${configPath}" << 'EOFCONFIG'
${configJson}
EOFCONFIG`], projectPath)

      if (!writeResult.success) {
        console.error('Failed to write config:', writeResult.output)
        // Try alternative method
        const writeResult2 = await runShellCommand('sh', ['-c', `printf '%s' '${configJson.replace(/'/g, "'\\''")}' > "${configPath}"`], projectPath)
        if (!writeResult2.success) {
          console.warn('Could not write config file, but directories created')
        }
      }

      console.log('Project structure created at:', projectPath)
      return projectPath
    } catch (e) {
      console.error('Failed to create project structure:', e)
      return null
    }
  }

  /**
   * Load project config from .construct/project.json
   */
  const loadProjectConfig = async (projectPath: string): Promise<ProjectConfig | null> => {
    await initTauri()
    if (!tauriFs) return null

    try {
      const normalizedProjectPath = normalizePath(projectPath)
      const configPath = `${normalizedProjectPath}/.construct/project.json`
      const exists = await tauriFs.exists(configPath)

      if (!exists) {
        return null
      }

      const content = await tauriFs.readTextFile(configPath)
      const raw = JSON.parse(content) as Record<string, unknown>

      // Normalize config — vibe/operator may write different field names or formats
      const config: ProjectConfig = {
        version: 1,
        name: (raw.name as string) || normalizedProjectPath.split('/').filter(Boolean).pop() || '',
        description: raw.description as string | undefined,
        local_path: (raw.local_path as string) || normalizedProjectPath,
        created: (raw.created as string) || (raw.created_at as string) || new Date().toISOString(),
        updated: (raw.updated as string) || (raw.updated_at as string) || new Date().toISOString(),
        repos: Array.isArray(raw.repos) ? raw.repos : [],
        spaces: Array.isArray(raw.spaces)
          ? raw.spaces
          : typeof raw.spaces === 'object' && raw.spaces
            ? Object.keys(raw.spaces)
            : ['code', 'docs'],
      }

      state.currentProjectPath = normalizedProjectPath
      state.currentConfig = config

      return config
    } catch (e) {
      // Scope errors for external paths are expected — don't spam console
      const msg = String(e)
      if (msg.includes('forbidden path')) {
        console.debug('[ProjectDir] Path outside scope:', normalizePath(projectPath))
      } else {
        console.warn('Failed to load project config:', e)
      }
      return null
    }
  }

  /**
   * Save project config to .construct/project.json
   */
  const saveProjectConfig = async (projectPath: string, config: ProjectConfig): Promise<boolean> => {
    await initTauri()
    if (!tauriFs) return false

    try {
      const normalizedProjectPath = normalizePath(projectPath)
      const configPath = `${normalizedProjectPath}/.construct/project.json`
      config.updated = new Date().toISOString()

      await tauriFs.writeTextFile(configPath, JSON.stringify(config, null, 2))

      state.currentConfig = config

      return true
    } catch (e) {
      console.error('Failed to save project config:', e)
      return false
    }
  }

  /**
   * List contents of a project directory
   */
  const listProjectDirectory = async (
    dirPath: string,
    recursive = false
  ): Promise<ProjectDirectoryEntry[]> => {
    await initTauri()
    if (!tauriFs) return []

    try {
      const normalizedDirPath = normalizePath(dirPath)
      const entries = await tauriFs.readDir(normalizedDirPath)
      const result: ProjectDirectoryEntry[] = []

      for (const entry of entries) {
        // Skip hidden files except .git
        if (entry.name.startsWith('.') && entry.name !== '.git') continue

        const fullPath = `${normalizedDirPath}/${entry.name}`
        const isDir = entry.isDirectory

        const projectEntry: ProjectDirectoryEntry = {
          name: entry.name,
          path: fullPath,
          isDirectory: isDir,
        }

        // Check if it's a git repo
        if (isDir) {
          try {
            const gitPath = `${fullPath}/.git`
            const isRepo = await tauriFs.exists(gitPath)
            if (isRepo) {
              projectEntry.isRepo = true
              projectEntry.repoStatus = 'unknown' // Would need git commands to determine
            }
          } catch {
            // Ignore errors checking for .git
          }

          // Recursively load children if requested
          if (recursive) {
            projectEntry.children = await listProjectDirectory(fullPath, true)
          }
        }

        result.push(projectEntry)
      }

      // Sort: directories first, then alphabetically
      result.sort((a, b) => {
        if (a.isDirectory !== b.isDirectory) {
          return a.isDirectory ? -1 : 1
        }
        return a.name.localeCompare(b.name)
      })

      return result
    } catch (e) {
      console.error('Failed to list project directory:', e)
      return []
    }
  }

  /**
   * List all projects in the projects root
   */
  const listProjects = async (): Promise<Array<{ name: string; path: string; config?: ProjectConfig }>> => {
    await initTauri()
    if (!tauriFs || !state.projectsRoot) return []

    try {
      const entries = await tauriFs.readDir(state.projectsRoot)
      const projects: Array<{ name: string; path: string; config?: ProjectConfig }> = []

      for (const entry of entries) {
        if (!entry.isDirectory || entry.name.startsWith('.')) continue

        const projectPath = `${normalizePath(state.projectsRoot)}/${entry.name}`
        const config = await loadProjectConfig(projectPath)

        projects.push({
          name: entry.name,
          path: projectPath,
          config: config || undefined,
        })
      }

      return projects
    } catch (e) {
      console.error('Failed to list projects:', e)
      return []
    }
  }

  /**
   * Add a repository to the project
   * Either clone from URL or move existing folder
   */
  const addRepository = async (
    projectPath: string,
    repoName: string,
    source: { type: 'clone'; url: string } | { type: 'move'; path: string }
  ): Promise<boolean> => {
    await initTauri()
    if (!tauriFs) return false

    try {
      const normalizedProjectPath = normalizePath(projectPath)
      const codePath = `${normalizedProjectPath}/code`
      const targetPath = `${codePath}/${repoName}`

      // Ensure code directory exists
      const codeExists = await tauriFs.exists(codePath)
      if (!codeExists) {
        await tauriFs.mkdir(codePath)
      }

      if (source.type === 'move') {
        // Move existing folder
        await tauriFs.rename(source.path, targetPath)
      } else {
        // Clone would need shell command - for now just create folder
        // TODO: Implement git clone via tauri-plugin-shell
        await tauriFs.mkdir(targetPath)
      }

      // Update project config
      const config = await loadProjectConfig(normalizedProjectPath)
      if (config) {
        config.repos.push({
          name: repoName,
          path: `code/${repoName}`,
          origin: source.type === 'clone' ? source.url : undefined,
        })
        await saveProjectConfig(normalizedProjectPath, config)
      }

      return true
    } catch (e) {
      console.error('Failed to add repository:', e)
      return false
    }
  }

  /**
   * Open folder picker dialog
   */
  const openFolderDialog = async (title = 'Select Folder'): Promise<string | null> => {
    await initTauri()
    if (!tauriDialog) return null

    try {
      const selected = await tauriDialog.open({
        directory: true,
        multiple: false,
        title,
      })

      return selected as string | null
    } catch (e) {
      console.error('Failed to open folder dialog:', e)
      return null
    }
  }

  /**
   * Check if a path is a valid Construct project
   */
  const isConstructProject = async (path: string): Promise<boolean> => {
    await initTauri()
    if (!tauriFs) return false

    try {
      const configPath = `${path}/.construct/project.json`
      return await tauriFs.exists(configPath)
    } catch {
      return false
    }
  }

  /**
   * Get default projects root path suggestion
   */
  const getDefaultProjectsRoot = async (): Promise<string> => {
    const initialized = await initTauri()
    if (!initialized || !tauriPath) {
      console.error('Tauri path API not available')
      return ''
    }

    try {
      const homeDir = await tauriPath.homeDir()
      // Ensure proper path joining (homeDir may or may not have trailing slash)
      const normalizedHome = homeDir.endsWith('/') ? homeDir.slice(0, -1) : homeDir
      const defaultPath = IS_DEV_INSTANCE.value
        ? `${normalizedHome}/ConstructDevMode`
        : `${normalizedHome}/ConstructProjects`
      console.log('Default projects root:', defaultPath)
      return defaultPath
    } catch (e) {
      console.error('Failed to get home directory:', e)
      return ''
    }
  }

  /**
   * Ensure project directory structure exists
   * Creates the standard directories if they don't exist
   * @param path - Project local path (defaults to current project's path)
   * @param spaces - Space directories to ensure exist
   */
  const ensureProjectStructure = async (
    path?: string,
    spaces: string[] = ['code', 'design', 'assets']
  ): Promise<boolean> => {
    const targetPath = normalizePath(path || projectLocalPath.value)
    if (!targetPath) {
      console.error('[ensureProjectStructure] No project path provided')
      return false
    }

    console.log('[ensureProjectStructure] Ensuring structure at:', targetPath)

    try {
      // Check if directory already has content (non-empty)
      const lsResult = await runShellCommand('ls', ['-A', targetPath], '/')
      const dirExists = lsResult.success && lsResult.output.trim().length > 0

      if (dirExists) {
        // Directory is not empty — only ensure .construct config dir, skip space folders
        console.log('[ensureProjectStructure] Directory not empty, skipping space folders')
        const mkdirResult = await runShellCommand('mkdir', ['-p', `${targetPath}/.construct`], '/')
        if (!mkdirResult.success) {
          console.error('[ensureProjectStructure] Failed to create .construct dir:', mkdirResult.output)
          return false
        }
        return true
      }

      // Empty or new directory — create full structure
      const allDirs = [
        targetPath,
        `${targetPath}/.construct`,
        ...spaces.map(s => `${targetPath}/${s}`)
      ]

      const mkdirResult = await runShellCommand('mkdir', ['-p', ...allDirs], '/')
      if (!mkdirResult.success) {
        console.error('[ensureProjectStructure] Failed to create directories:', mkdirResult.output)
        return false
      }

      console.log('[ensureProjectStructure] Directories created successfully')
      return true
    } catch (e) {
      console.error('[ensureProjectStructure] Error:', e)
      return false
    }
  }

  /**
   * Set up watcher for project local_path changes
   * When path changes, recreate the directory structure
   */
  const setupLocalPathWatcher = () => {
    if (!projectStore) return

    // Watch for local_path changes
    watch(
      () => projectStore.currentProject?.local_path,
      async (newPath, oldPath) => {
        const normalizedNewPath = normalizePath(newPath || '')
        const normalizedOldPath = normalizePath(oldPath || '')

        // Skip initial watch trigger or same path
        if (!normalizedNewPath || normalizedNewPath === normalizedOldPath) return

        // Skip if this is just the initial set (not a change)
        if (!previousLocalPath && !normalizedOldPath) {
          previousLocalPath = normalizedNewPath
          return
        }

        console.log('[LocalPathWatcher] Path changed from', normalizedOldPath, 'to', normalizedNewPath)
        previousLocalPath = normalizedNewPath

        // Get project's enabled spaces for directory creation
        const spaces = projectStore.currentProject?.spaces || ['code', 'ui', 'assets']

        // Ensure the new directory structure exists
        const success = await ensureProjectStructure(normalizedNewPath, spaces)
        if (success) {
          console.log('[LocalPathWatcher] Directory structure ensured at:', normalizedNewPath)
        } else {
          console.error('[LocalPathWatcher] Failed to ensure directory structure')
        }
      },
      { immediate: false }
    )
  }

  // Set up watcher on composable init (only if in browser)
  if (typeof window !== 'undefined' && projectStore) {
    setupLocalPathWatcher()
  }

  return {
    state: readonly(state),

    // Global project path (reactive)
    projectLocalPath,
    resolveProjectPath,
    getSpacePath,
    isWithinProject,

    // Initialization
    initTauri,

    // Projects root management
    getProjectsRoot,
    setProjectsRoot,
    promptForProjectsRoot,
    getDefaultProjectsRoot,

    // Project operations
    createProjectStructure,
    ensureProjectStructure,
    loadProjectConfig,
    saveProjectConfig,
    listProjects,
    isConstructProject,

    // Directory operations
    listProjectDirectory,
    openFolderDialog,

    // Content management
    addRepository,
  }
}
