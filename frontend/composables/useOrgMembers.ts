/**
 * useOrgMembers — focused slice of the org store for spaces.
 *
 * Org-scoped spaces (kanban assignee picker, mentions, approvals) need
 * the member roster but shouldn't have to learn the full 400-line
 * useOrgStore API. This wrapper exposes just the read side + a couple
 * of convenience lookups, and auto-triggers `fetchAll` the first time
 * it's called in a session so callers can `const { members } = ...`
 * and render immediately.
 *
 * The underlying Pinia store is shared, so every space calling this
 * reuses the same fetched list — no duplicate /org/members round-trips.
 */
import { computed } from 'vue'
import { useOrgStore } from '@/stores/org'
import { useAuthStore } from '@/stores/auth'
import type { OrgMember } from '@/types/org'

function normalizeMember(member: OrgMember, selfId?: string, selfAvatar?: string): OrgMember {
  const name = member.name || member.email || member.user_id
  // The org-members API doesn't always carry the profile avatar. For the
  // current user we know it from the auth store, so backfill it when missing
  // (so chat/mentions show the real avatar, not just initials).
  let avatar = member.avatar
  if (!avatar && selfId && String(member.user_id) === String(selfId)) {
    avatar = selfAvatar || ''
  }
  return {
    ...member,
    name,
    avatar,
  }
}

export function useOrgMembers() {
  const org = useOrgStore()
  const auth = useAuthStore()
  const members = computed<OrgMember[]>(() => {
    const selfId = auth.user?.id != null ? String(auth.user.id) : undefined
    const selfAvatar = auth.user?.avatar || undefined
    return org.members.map(m => normalizeMember(m, selfId, selfAvatar))
  })

  // Kick the fetch if nothing has hydrated the store yet. Fire-and-
  // forget — the `loading` ref lets the caller render a skeleton.
  if (!org.hydrated && !org.loading) {
    org.fetchAll().catch(() => { /* surface via org.loading state */ })
  }

  return {
    /** Reactive roster. Empty until fetchAll resolves. */
    members,
    /** True while the initial (or refreshed) fetch is in flight. */
    loading: computed<boolean>(() => org.loading),
    /** Current org id, or null when no org is active for this user. */
    orgId: computed<string | null>(() => org.orgId),
    /** Member count — handy for badges without pulling the whole list. */
    memberCount: computed<number>(() => org.memberCount),

    /** Find a member by the org-scoped member id (`members[].id`). */
    byId: (id: string): OrgMember | null =>
      members.value.find(m => m.id === id) ?? null,
    /** Find a member by the underlying accounts user id. */
    byUserId: (userId: string): OrgMember | null =>
      members.value.find(m => m.user_id === userId) ?? null,

    /** Force a fresh fetch (e.g. after an admin invites someone). */
    refresh: (): Promise<void> => org.fetchAll(),
  }
}
