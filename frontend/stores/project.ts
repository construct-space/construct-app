import { defineStore } from 'pinia'
import type { LocalProject, SpaceType } from '@/types/project'

// Backward-compatible alias — old code imports `Project` from this store
export type Project = LocalProject

const STORAGE_KEY_RECENTS = 'construct_recent_projects'
const STORAGE_KEY_EXTERNALS = 'construct_external_paths'
const STORAGE_KEY_ROOT = 'construct_projects_root'
const MAX_RECENTS = 20

// All spaces available to every project by default
const DEFAULT_SPACES: SpaceType[] = [
  'code', 'design', 'kanban', 'docs', 'notes',
  'architect', 'git', 'terminal', 'calendar'
]

const normalizePath = (value: string): string => {
  if (!value) return value
  if (value === '/') return value
  return value.replace(/\/+$/g, '')
}

const parentPath = (value: string): string => {
  const normalized = normalizePath(value)
  if (!normalized || normalized === '/') return ''
  const parts = normalized.split('/').filter(Boolean)
  if (parts.length <= 1) return '/'
  return `/${parts.slice(0, -1).join('/')}`
}

const slugifyProjectToken = (value: string): string => {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

const buildProjectId = (name: string, isExternal = false): string => {
  const slug = slugifyProjectToken(name) || 'project'
  return isExternal ? `ext-${slug}` : slug
}

const projectLookupCandidates = (project: LocalProject): Set<string> => {
  const id = String(project.id || '')
  const name = project.name || ''
  const pathName = (project.path || '').split('/').filter(Boolean).pop() || ''
  const isExternal = Boolean(project.is_external) || id.startsWith('ext-')
  const canonical = buildProjectId(name || pathName || id, isExternal)

  return new Set([
    id,
    slugifyProjectToken(id),
    name,
    slugifyProjectToken(name),
    pathName,
    slugifyProjectToken(pathName),
    canonical,
    slugifyProjectToken(canonical),
  ])
}

const projectMatchesLookup = (project: LocalProject, lookup: string): boolean => {
  if (!lookup) return false

  const rawLookup = String(lookup)
  const slugLookup = slugifyProjectToken(rawLookup)
  const unprefixedLookup = rawLookup.replace(/^ext-/, '')
  const slugUnprefixedLookup = slugifyProjectToken(unprefixedLookup)
  const wantsExternal = rawLookup.startsWith('ext-')

  const candidates = projectLookupCandidates(project)
  if (candidates.has(rawLookup) || candidates.has(slugLookup)) return true

  if (wantsExternal) {
    return candidates.has(`ext-${slugUnprefixedLookup}`)
  }

  return candidates.has(unprefixedLookup) || candidates.has(slugUnprefixedLookup)
}

export const useProjectStore = defineStore('project', {
  state: () => ({
    currentProject: null as LocalProject | null,
    projects: [] as LocalProject[],
    recentProjects: [] as LocalProject[],
    externalPaths: [] as string[],
    projectsRoot: '' as string,
    loading: false,
    error: null as string | null,
  }),

  getters: {
    hasProject: (state) => !!state.currentProject,

    projectSpaces: (state) => {
      return state.currentProject?.spaces || DEFAULT_SPACES
    },

    hasSpace: () => (_spaceName: string) => {
      // All spaces are always available in personal mode
      return true
    },

    /** Find a project by its slug ID across projects and recents */
    getProjectById: (state) => (id: string): LocalProject | null => {
      return state.projects.find(p => projectMatchesLookup(p, id))
        || state.recentProjects.find(p => projectMatchesLookup(p, id))
        || null
    },
  },

  actions: {
    async initialize() {
      // Load persisted state from localStorage only — no FS scanning.
      // FS scanning happens lazily via loadProjects() when pages need it.
      this.projectsRoot = normalizePath(localStorage.getItem(STORAGE_KEY_ROOT) || '')

      const rawExternals = JSON.parse(localStorage.getItem(STORAGE_KEY_EXTERNALS) || '[]') as string[]
      this.externalPaths = [...new Set(rawExternals.map(path => normalizePath(path)).filter(Boolean))]
      localStorage.setItem(STORAGE_KEY_EXTERNALS, JSON.stringify(this.externalPaths))

      const rawRecents = JSON.parse(localStorage.getItem(STORAGE_KEY_RECENTS) || '[]') as LocalProject[]
      this.recentProjects = rawRecents.map((project) => {
        const normalizedPath = normalizePath(project.path)
        return {
          ...project,
          path: normalizedPath,
          local_path: normalizePath(project.local_path || normalizedPath),
        }
      })
      localStorage.setItem(STORAGE_KEY_RECENTS, JSON.stringify(this.recentProjects))
    },

    async loadProjects() {
      this.loading = true
      this.error = null

      try {
        const { useProjectDirectory } = await import('@/composables/useProjectDirectory')
        const projectDir = useProjectDirectory()

        // Auto-initialize projectsRoot if not set
        if (!this.projectsRoot) {
          const defaultRoot = await projectDir.getDefaultProjectsRoot()
          if (defaultRoot) {
            await projectDir.setProjectsRoot(defaultRoot)
            this.projectsRoot = defaultRoot
            localStorage.setItem('construct_projects_root', defaultRoot)
          }
        } else {
          await projectDir.setProjectsRoot(this.projectsRoot)
        }

        const projects: LocalProject[] = []

        // Load managed projects from projects root (if configured)
        if (this.projectsRoot) {
          const entries = await projectDir.listProjects()

          // Space names that might exist as stale empty folders at the root
          const spaceNames = new Set(DEFAULT_SPACES)

          for (const entry of entries) {
            const config = entry.config
            // Skip empty directories named after spaces (stale root-level space folders)
            if (!config && spaceNames.has(entry.name as SpaceType)) continue

            projects.push({
              id: buildProjectId(entry.name),
              name: config?.name || entry.name,
              path: entry.path,
              description: config?.description,
              spaces: (config?.spaces as SpaceType[]) || DEFAULT_SPACES,
              last_opened_at: this.getRecentTimestamp(entry.path),
              is_external: false,
              created_at: config?.created || new Date().toISOString(),
              updated_at: config?.updated || new Date().toISOString(),
            })
          }
        }

        // Add external projects
        const normalizedExternals = [...new Set(this.externalPaths.map(path => normalizePath(path)).filter(Boolean))]
        if (normalizedExternals.length !== this.externalPaths.length
          || normalizedExternals.some((value, index) => value !== this.externalPaths[index])) {
          this.externalPaths = normalizedExternals
          localStorage.setItem(STORAGE_KEY_EXTERNALS, JSON.stringify(this.externalPaths))
        }

        const validExternals: string[] = []
        for (const extPath of normalizedExternals) {
          // Skip external paths that no longer exist on disk
          try {
            const tauriFs = await import('@tauri-apps/plugin-fs')
            if (!await tauriFs.exists(extPath)) continue
          } catch {
            continue
          }
          validExternals.push(extPath)

          const name = extPath.split('/').filter(Boolean).pop() || extPath
          const existing = projects.find(p => p.path === extPath)
          if (!existing) {
            const { useProjectDirectory } = await import('@/composables/useProjectDirectory')
            const projectDir = useProjectDirectory()
            const config = await projectDir.loadProjectConfig(extPath).catch(() => null)
            projects.push({
              id: buildProjectId(name, true),
              name: config?.name || name,
              path: extPath,
              description: config?.description,
              spaces: (config?.spaces as SpaceType[]) || DEFAULT_SPACES,
              last_opened_at: this.getRecentTimestamp(extPath),
              is_external: true,
              created_at: config?.created || new Date().toISOString(),
              updated_at: config?.updated || new Date().toISOString(),
            })
          }
        }
        // Prune stale external paths
        if (validExternals.length !== normalizedExternals.length) {
          this.externalPaths = validExternals
          localStorage.setItem(STORAGE_KEY_EXTERNALS, JSON.stringify(validExternals))
        }

        // Set local_path alias for backward compat
        for (const p of projects) {
          p.path = normalizePath(p.path)
          p.local_path = normalizePath(p.path)
        }
        this.projects = projects

        // Prune stale recents — remove entries whose paths don't exist on disk
        const projectPaths = new Set(projects.map(p => p.path))
        const validRecents = this.recentProjects.filter(r => projectPaths.has(normalizePath(r.path)))
        if (validRecents.length !== this.recentProjects.length) {
          this.recentProjects = validRecents
          localStorage.setItem(STORAGE_KEY_RECENTS, JSON.stringify(this.recentProjects))
        }
      } catch (error) {
        this.error = (error as Error).message || 'Failed to load projects'
        console.warn('Failed to load projects:', error)
      } finally {
        this.loading = false
      }
    },

    async createProject(data: { name: string; description?: string; spaces?: SpaceType[]; localPath?: string }) {
      this.loading = true
      this.error = null

      try {
        const { useProjectDirectory } = await import('@/composables/useProjectDirectory')
        const projectDir = useProjectDirectory()

        // Ensure projects root exists
        if (!this.projectsRoot) {
          const root = await projectDir.getProjectsRoot()
          if (root) {
            this.projectsRoot = normalizePath(root)
            localStorage.setItem(STORAGE_KEY_ROOT, this.projectsRoot)
          } else if (!data.localPath) {
            throw new Error('No projects root directory set')
          }
        }

        const spaces = data.spaces || DEFAULT_SPACES
        let createdPath: string | null

        if (data.localPath) {
          // Caller provided an explicit path — use it directly (e.g. from Architect kickoff)
          createdPath = await projectDir.createProjectStructure(data.name, data.localPath, spaces, true)
        } else {
          // Derive path from projectsRoot/name
          createdPath = await projectDir.createProjectStructure(data.name, this.projectsRoot, spaces)
        }

        if (!createdPath) {
          throw new Error('Failed to create project structure')
        }

        const project: LocalProject = {
          id: buildProjectId(data.name),
          name: data.name,
          path: normalizePath(createdPath),
          local_path: normalizePath(createdPath),
          description: data.description,
          spaces,
          last_opened_at: new Date().toISOString(),
          is_external: false,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }

        this.projects.push(project)
        this.trackRecentOpen(project)

        return { success: true as const, data: project }
      } catch (error) {
        this.error = (error as Error).message || 'Failed to create project'
        return { success: false as const, error: this.error }
      } finally {
        this.loading = false
      }
    },

    openProject(path: string) {
      const normalizedPath = normalizePath(path)
      const project = this.projects.find(p => normalizePath(p.path) === normalizedPath)
      if (project) {
        this.currentProject = project
        this.trackRecentOpen(project)
        return project
      }

      // Project not in list — create a minimal entry
      const name = normalizedPath.split('/').filter(Boolean).pop() || normalizedPath
      const newProject: LocalProject = {
        id: buildProjectId(name, true),
        name,
        path: normalizedPath,
        local_path: normalizedPath,
        spaces: DEFAULT_SPACES,
        last_opened_at: new Date().toISOString(),
        is_external: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }

      const normalizedRoot = normalizePath(this.projectsRoot)
      const isManagedProject = Boolean(normalizedRoot)
        && (normalizedPath === normalizedRoot || normalizedPath.startsWith(`${normalizedRoot}/`))
      if (!isManagedProject && !this.externalPaths.includes(normalizedPath)) {
        this.externalPaths.push(normalizedPath)
        localStorage.setItem(STORAGE_KEY_EXTERNALS, JSON.stringify(this.externalPaths))
      }
      if (!normalizedRoot) {
        const parent = parentPath(normalizedPath)
        if (parent) {
          this.projectsRoot = parent
          localStorage.setItem(STORAGE_KEY_ROOT, this.projectsRoot)
        }
      }

      this.projects.push(newProject)
      this.currentProject = newProject
      this.trackRecentOpen(newProject)
      return newProject
    },

    updateProject(_projectId: string | number, data: Partial<{ name: string; description: string; spaces: string[]; local_path: string }>) {
      // In-memory update only — FS config persistence handled by space-projects
      if (this.currentProject) {
        if (data.name) this.currentProject.name = data.name
        if (data.description) this.currentProject.description = data.description
        if (data.spaces) this.currentProject.spaces = data.spaces as SpaceType[]
        this.currentProject.updated_at = new Date().toISOString()
      }
      return { success: true, data: this.currentProject }
    },

    /** Open a project by its slug ID (used by project-scoped routes) */
    openProjectById(id: string): LocalProject | null {
      const project = this.getProjectById(id)
      if (project) {
        this.currentProject = project
        this.trackRecentOpen(project)
        return project
      }
      return null
    },

    clearCurrentProject() {
      this.currentProject = null
    },

    async addExternalFolderByPath(path: string): Promise<LocalProject | null> {
      const normalizedPath = normalizePath(path)
      if (!normalizedPath) return null

      if (!this.externalPaths.includes(normalizedPath)) {
        this.externalPaths.push(normalizedPath)
        localStorage.setItem(STORAGE_KEY_EXTERNALS, JSON.stringify(this.externalPaths))
      }

      // Reload projects to include the external path.
      await this.loadProjects()
      return this.projects.find(p => p.path === normalizedPath) || null
    },

    async addExternalProject(path: string): Promise<LocalProject | null> {
      return this.addExternalFolderByPath(path)
    },

    trackRecentOpen(project: LocalProject) {
      project.path = normalizePath(project.path)
      project.local_path = normalizePath(project.local_path || project.path)
      project.last_opened_at = new Date().toISOString()

      // Update in projects list
      const idx = this.projects.findIndex(p => p.path === project.path)
      if (idx !== -1) {
        this.projects[idx] = { ...project }
      }

      // Update recents list
      const recents = this.recentProjects.filter(p => p.path !== project.path)
      recents.unshift({ ...project })
      this.recentProjects = recents.slice(0, MAX_RECENTS)

      localStorage.setItem(STORAGE_KEY_RECENTS, JSON.stringify(this.recentProjects))
    },

    removeProject(path: string) {
      const normalizedPath = normalizePath(path)

      // Remove from external paths
      this.externalPaths = this.externalPaths.filter(p => p !== normalizedPath)
      localStorage.setItem(STORAGE_KEY_EXTERNALS, JSON.stringify(this.externalPaths))

      // Remove from recents
      this.recentProjects = this.recentProjects.filter(p => p.path !== normalizedPath)
      localStorage.setItem(STORAGE_KEY_RECENTS, JSON.stringify(this.recentProjects))

      // Remove from projects list
      this.projects = this.projects.filter(p => p.path !== normalizedPath)

      // Clear current if it was the removed project
      if (this.currentProject?.path === normalizedPath) {
        this.currentProject = null
      }
    },

    async deleteProjectFromDisk(path: string) {
      this.removeProject(path)
      try {
        const { invoke } = await import('@tauri-apps/api/core')
        const tauriFs = await import('@tauri-apps/plugin-fs')
        if (await tauriFs.exists(path)) {
          // Use macOS trash command to move to Trash instead of permanent deletion
          const result = await invoke<{ success: boolean; code: number | null; stdout: string; stderr: string }>('run_shell_command', {
            command: 'trash',
            args: [path],
            cwd: '/'
          })
          if (!result.success) {
            // Fallback: use Finder's "move to trash" via osascript
            await invoke('run_shell_command', {
              command: 'osascript',
              args: ['-e', `tell application "Finder" to delete (POSIX file "${path}" as alias)`],
              cwd: '/'
            })
          }
        }
      } catch (e) {
        console.error('Failed to move project to trash:', e)
      }
    },

    async updateProjectConfig(path: string, data: { name?: string; description?: string; spaces?: string[] }) {
      const { useProjectDirectory } = await import('@/composables/useProjectDirectory')
      const projectDir = useProjectDirectory()
      const config = await projectDir.loadProjectConfig(path)
      if (!config) return

      if (data.name !== undefined) config.name = data.name
      if (data.description !== undefined) config.description = data.description
      if (data.spaces !== undefined) config.spaces = data.spaces
      config.updated = new Date().toISOString()

      await projectDir.saveProjectConfig(path, config)

      // Update in-memory
      const p = this.projects.find(proj => proj.path === path)
      if (p) {
        if (data.name !== undefined) p.name = data.name
        if (data.description !== undefined) p.description = data.description
        if (data.spaces !== undefined) p.spaces = data.spaces as SpaceType[]
        p.updated_at = config.updated
      }
    },

    setProjectsRoot(path: string) {
      this.projectsRoot = normalizePath(path)
      localStorage.setItem(STORAGE_KEY_ROOT, this.projectsRoot)
    },

    getRecentTimestamp(path: string): string {
      const normalizedPath = normalizePath(path)
      const recent = this.recentProjects.find(p => normalizePath(p.path) === normalizedPath)
      return recent?.last_opened_at || ''
    },
  },
})
