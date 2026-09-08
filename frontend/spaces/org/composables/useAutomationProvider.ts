/**
 * Org Space Automation Provider
 *
 * Exposes the active organization's people/structure as semantic
 * actions so brain can answer "who's in the org", "list my team",
 * "invite X" etc. without scraping the UI. Read-only actions return
 * data; mutating actions delegate to useOrgStore.
 *
 * Registered once at app startup via registerCoreSpaceProviders() —
 * NOT on page mount — so brain can run these actions headlessly (e.g.
 * resolving a person from the assistant while the user is in another
 * space) without the Org page ever opening.
 */

import { useOrgStore } from '@/stores/org'
import type { AutomationProvider, SpaceSnapshot, AutomationAction, ActionResult } from '@/types/automation'

export function createAutomationProvider(): AutomationProvider {
  const org = useOrgStore()

  const provider: AutomationProvider = {
    snapshot(): SpaceSnapshot {
      return {
        space_id: 'org',
        title: org.orgName || 'Organization',
        state: {
          enabled: org.isEnabled,
          org_id: org.orgId,
          org_name: org.orgName,
          member_count: org.memberCount,
          department_count: org.departmentCount,
          team_count: org.teamCount,
          pending_invites: org.pendingInviteCount,
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
          case 'org.info':
            return {
              success: true,
              data: {
                enabled: org.isEnabled,
                id: org.orgId,
                name: org.orgName,
                counts: {
                  members: org.memberCount,
                  departments: org.departmentCount,
                  teams: org.teamCount,
                  pending_invites: org.pendingInviteCount,
                },
              },
            }

          case 'org.list_members':
            if (!org.hydrated) await org.fetchAll()
            return { success: true, data: { members: org.members } }

          case 'org.list_departments':
            if (!org.hydrated) await org.fetchAll()
            return { success: true, data: { departments: org.departments } }

          case 'org.list_teams':
            if (!org.hydrated) await org.fetchAll()
            return { success: true, data: { teams: org.teams } }

          case 'org.list_invitations':
            if (!org.hydrated) await org.fetchAll()
            return { success: true, data: { invitations: org.invites } }

          case 'org.refresh':
            await org.fetchAll()
            return { success: true, data: { count: org.memberCount } }

          case 'org.remove_member': {
            const id = payload?.id as string
            if (!id) return { success: false, error: 'id is required' }
            const ok = await org.removeMember(id)
            return ok ? { success: true, data: { removed: id } } : { success: false, error: 'remove failed' }
          }

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
        id: 'org.info',
        description: 'Get current organization summary: name, id, member/team/department counts',
        params: { type: 'object', properties: {} },
      },
      {
        id: 'org.list_members',
        description: 'List all organization members',
        params: { type: 'object', properties: {} },
      },
      {
        id: 'org.list_departments',
        description: 'List all departments in the organization',
        params: { type: 'object', properties: {} },
      },
      {
        id: 'org.list_teams',
        description: 'List all teams in the organization',
        params: { type: 'object', properties: {} },
      },
      {
        id: 'org.list_invitations',
        description: 'List pending and recent invitations',
        params: { type: 'object', properties: {} },
      },
      {
        id: 'org.refresh',
        description: 'Refresh organization data from the server',
        params: { type: 'object', properties: {} },
      },
      {
        id: 'org.remove_member',
        description: 'Remove a member from the organization',
        params: {
          type: 'object',
          properties: { id: { type: 'string', description: 'Member ID' } },
          required: ['id'],
        },
      },
    ]
  }

  return provider
}
