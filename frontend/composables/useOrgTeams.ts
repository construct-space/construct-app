/**
 * useOrgTeams — read slice of teams + team-member join table.
 *
 * Teams group members below the org/department level. Spaces use them
 * for "assign to team", filter-by-team views, and per-team dashboards.
 * Mirrors useOrgMembers' shape: auto-fetch on first use, lookups, no
 * write methods (those stay on the admin surface).
 */
import { computed } from 'vue'
import { useOrgStore } from '@/stores/org'
import type { Team, TeamMember, OrgMember } from '@/types/org'

export function useOrgTeams() {
  const org = useOrgStore()

  if (!org.hydrated && !org.loading) {
    org.fetchAll().catch(() => { /* surface via loading state */ })
  }

  return {
    /** Reactive list of teams in the current org. */
    teams: computed<Team[]>(() => org.teams),
    /** Raw team↔member join rows. Use `membersOf(teamId)` for resolved members. */
    teamMembers: computed<TeamMember[]>(() => org.teamMembers),
    /** True while a fetch is in flight. */
    loading: computed<boolean>(() => org.loading),
    /** Team count — for badges. */
    teamCount: computed<number>(() => org.teamCount),

    /** Lookup a team by id. */
    byId: (id: string): Team | null =>
      org.teams.find(t => t.id === id) ?? null,

    /** Resolved OrgMember list for a given team. Joins team_members → members. */
    membersOf: (teamId: string): OrgMember[] => {
      const memberIds = new Set(
        org.teamMembers.filter(tm => tm.team_id === teamId).map(tm => tm.member_id),
      )
      return org.members.filter(m => memberIds.has(m.id))
    },

    /** Teams a given member belongs to. */
    teamsOf: (memberId: string): Team[] => {
      const teamIds = new Set(
        org.teamMembers.filter(tm => tm.member_id === memberId).map(tm => tm.team_id),
      )
      return org.teams.filter(t => teamIds.has(t.id))
    },

    /** Force a fresh fetch (e.g. after an admin added a team). */
    refresh: (): Promise<void> => org.fetchAll(),
  }
}
