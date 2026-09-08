/**
 * Project Space Automation Provider
 *
 * Registers semantic actions for the project space so the operator
 * can query state and trigger actions via the desktop bridge.
 *
 * Registered once at app startup via registerCoreSpaceProviders() —
 * NOT on page mount — so brain can list/create/open projects headlessly
 * without the Projects page ever opening.
 */

import { useProjectStore } from '@/stores/project'
import type { AutomationProvider, SpaceSnapshot, AutomationAction, ActionResult } from '@/types/automation'

export function createAutomationProvider(): AutomationProvider {
  const projectStore = useProjectStore()

  const provider: AutomationProvider = {
    snapshot(): SpaceSnapshot {
      const current = projectStore.currentProject
      return {
        space_id: 'project',
        title: current?.name ?? 'Projects',
        state: {
          current_project: current
            ? {
                id: current.id,
                name: current.name,
                path: current.path,
                description: current.description ?? '',
              }
            : null,
          projects_count: projectStore.projects.length,
          projects_root: projectStore.projectsRoot,
          recent_projects: projectStore.recentProjects.slice(0, 5).map(p => ({
            id: p.id,
            name: p.name,
            path: p.path,
          })),
          loading: projectStore.loading,
        },
        actions: allActions().map(a => a.id),
      }
    },

    listActions(): AutomationAction[] {
      return allActions()
    },

    async runAction(actionId: string, payload?: Record<string, unknown>): Promise<ActionResult> {
      try {
        switch (actionId) {
          case 'project.list':
            await projectStore.loadProjects()
            return {
              success: true,
              data: {
                projects: projectStore.projects.map(p => ({
                  id: p.id,
                  name: p.name,
                  path: p.path,
                  description: p.description ?? '',
                })),
              },
            }

          case 'project.create': {
            const name = payload?.name as string
            if (!name) return { success: false, error: 'name is required' }
            await projectStore.createProject({
              name,
              description: payload?.description as string | undefined,
            })
            return {
              success: true,
              data: { message: `Project "${name}" created` },
            }
          }

          case 'project.open': {
            const id = payload?.id as string
            if (!id) return { success: false, error: 'id is required' }
            const project = projectStore.getProjectById(id)
            if (!project) return { success: false, error: `Project not found: ${id}` }
            projectStore.openProject(project.path)
            return {
              success: true,
              data: { id: project.id, name: project.name, path: project.path },
            }
          }

          case 'project.refresh':
            await projectStore.loadProjects()
            return {
              success: true,
              data: { count: projectStore.projects.length },
            }

          default:
            return { success: false, error: `Unknown action: ${actionId}` }
        }
      } catch (e) {
        return {
          success: false,
          error: e instanceof Error ? e.message : String(e),
        }
      }
    },
  }

  function allActions(): AutomationAction[] {
    return [
      {
        id: 'project.list',
        description: 'List all projects',
        params: { type: 'object', properties: {} },
      },
      {
        id: 'project.create',
        description: 'Create a new project',
        params: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Project name' },
            description: { type: 'string', description: 'Project description' },
          },
          required: ['name'],
        },
      },
      {
        id: 'project.open',
        description: 'Open/switch to a project by ID',
        params: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'Project ID or name' },
          },
          required: ['id'],
        },
      },
      {
        id: 'project.refresh',
        description: 'Refresh the project list from disk',
        params: { type: 'object', properties: {} },
      },
    ]
  }

  return provider
}
