/**
 * Org Project Space Automation Provider
 *
 * Exposes the organization-shared projects as semantic actions so
 * brain can list, open, and create org projects without scraping the
 * UI. Mirrors the personal `project` space provider but reads from
 * the org-projects API.
 *
 * Registered once at app startup via registerCoreSpaceProviders() —
 * NOT on page mount — so brain can reach org projects headlessly.
 */

import { useOrgProjects } from './useOrgProjects'
import type { AutomationProvider, SpaceSnapshot, AutomationAction, ActionResult } from '@/types/automation'

export function createAutomationProvider(): AutomationProvider {
  const { projects, fetchProjects, fetchProject, createProject } = useOrgProjects()

  const provider: AutomationProvider = {
    snapshot(): SpaceSnapshot {
      return {
        space_id: 'org-project',
        title: 'Org Projects',
        state: {
          projects_count: projects.value.length,
          projects: projects.value.slice(0, 10).map(p => ({
            id: p.id,
            name: p.name,
            description: p.description ?? '',
          })),
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
          case 'org_project.list':
            await fetchProjects()
            return {
              success: true,
              data: { projects: projects.value },
            }

          case 'org_project.get': {
            const id = payload?.id as string
            if (!id) return { success: false, error: 'id is required' }
            const project = await fetchProject(id)
            if (!project) return { success: false, error: `Project not found: ${id}` }
            return { success: true, data: { project } }
          }

          case 'org_project.create': {
            const name = payload?.name as string
            if (!name) return { success: false, error: 'name is required' }
            const created = await createProject({
              name,
              description: payload?.description as string | undefined,
            })
            return created
              ? { success: true, data: { project: created } }
              : { success: false, error: 'Failed to create org project' }
          }

          case 'org_project.refresh':
            await fetchProjects()
            return { success: true, data: { count: projects.value.length } }

          default:
            return { success: false, error: `Unknown action: ${actionId}` }
        }
      } catch (e) {
        return { success: false, error: e instanceof Error ? e.message : String(e) }
      }
    },
  }

  function allActions(): AutomationAction[] {
    return [
      {
        id: 'org_project.list',
        description: 'List all organization-shared projects',
        params: { type: 'object', properties: {} },
      },
      {
        id: 'org_project.get',
        description: 'Get details of one org project by ID',
        params: {
          type: 'object',
          properties: { id: { type: 'string', description: 'Org project ID' } },
          required: ['id'],
        },
      },
      {
        id: 'org_project.create',
        description: 'Create a new org-shared project',
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
        id: 'org_project.refresh',
        description: 'Refresh org projects from the server',
        params: { type: 'object', properties: {} },
      },
    ]
  }

  return provider
}
