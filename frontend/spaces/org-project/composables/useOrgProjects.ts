/**
 * useOrgProjects — CRUD for org-wide projects via Source API.
 */
import { ref } from 'vue'
import { useSource } from '@/composables/useSource'
import type { OrgMember } from '@/types/org'

export interface OrgProjectRepo {
  id: string
  project_id: string
  name: string
  repo_url: string
  default_branch: string
  created_at: string
}

export interface OrgProject {
  id: string
  name: string
  description: string
  repo_url: string
  default_branch: string
  framework: string
  created_by: string
  created_at: string
  updated_at: string
}

// Module-scope state — shared across every useOrgProjects() consumer so the
// list page, detail page, layout, and breadcrumb all see the same data and
// only one fetch round-trip is needed.
const projects = ref<OrgProject[]>([])
const loading = ref(false)
const error = ref<string | null>(null)

/** Look up a cached org project by id without subscribing to the composable. */
export function getCachedOrgProject(id: string): OrgProject | undefined {
  return projects.value.find(p => p.id === id)
}

export function useOrgProjects() {
  const api = useSource()

  async function fetchProjects() {
    loading.value = true
    error.value = null
    try {
      const data = await api.get<OrgProject[]>('/org/projects')
      projects.value = Array.isArray(data) ? data : []
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to load projects'
    } finally {
      loading.value = false
    }
  }

  async function fetchProject(id: string): Promise<OrgProject | null> {
    try {
      const data = await api.get<OrgProject>(`/org/projects/${id}`)
      if (data?.id) {
        // Merge into local list if not already present
        const idx = projects.value.findIndex(p => p.id === data.id)
        if (idx >= 0) projects.value[idx] = data
        else projects.value.push(data)
        return data
      }
      return null
    } catch {
      return null
    }
  }

  async function createProject(project: Partial<OrgProject>): Promise<OrgProject | null> {
    error.value = null
    try {
      const created = await api.post<OrgProject>('/org/projects', project)
      projects.value.unshift(created)
      return created
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to create project'
      return null
    }
  }

  async function updateProject(id: string, updates: Partial<OrgProject>): Promise<boolean> {
    try {
      const updated = await api.put<OrgProject>(`/org/projects/${id}`, updates)
      const idx = projects.value.findIndex(p => p.id === id)
      if (idx >= 0) projects.value[idx] = updated
      return true
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to update project'
      return false
    }
  }

  async function deleteProject(id: string): Promise<boolean> {
    try {
      await api.delete(`/org/projects/${id}`)
      projects.value = projects.value.filter(p => p.id !== id)
      return true
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to delete project'
      return false
    }
  }

  async function fetchProjectMembers(projectId: string): Promise<OrgMember[]> {
    try {
      const data = await api.get<OrgMember[]>(`/org/projects/${projectId}/members`)
      return Array.isArray(data) ? data : []
    } catch {
      return []
    }
  }

  async function addProjectMember(projectId: string, memberId: string): Promise<boolean> {
    try {
      await api.post(`/org/projects/${projectId}/members`, { member_id: memberId })
      return true
    } catch (e) {
      console.error('[org-project] addProjectMember failed:', e)
      return false
    }
  }

  async function removeProjectMember(projectId: string, memberId: string): Promise<boolean> {
    try {
      await api.delete(`/org/projects/${projectId}/members/${memberId}`)
      return true
    } catch (e) {
      console.error('[org-project] removeProjectMember failed:', e)
      return false
    }
  }

  async function fetchProjectRepos(projectId: string): Promise<OrgProjectRepo[]> {
    try {
      const data = await api.get<OrgProjectRepo[]>(`/org/projects/${projectId}/repos`)
      return Array.isArray(data) ? data : []
    } catch {
      return []
    }
  }

  async function addProjectRepo(projectId: string, repo: { name?: string; repo_url: string; default_branch?: string }): Promise<OrgProjectRepo | null> {
    try {
      return await api.post<OrgProjectRepo>(`/org/projects/${projectId}/repos`, repo)
    } catch (e) {
      console.error('[org-project] addProjectRepo failed:', e)
      return null
    }
  }

  async function removeProjectRepo(projectId: string, repoId: string): Promise<boolean> {
    try {
      await api.delete(`/org/projects/${projectId}/repos/${repoId}`)
      return true
    } catch {
      return false
    }
  }

  return { projects, loading, error, fetchProjects, fetchProject, createProject, updateProject, deleteProject, fetchProjectMembers, addProjectMember, removeProjectMember, fetchProjectRepos, addProjectRepo, removeProjectRepo }
}
