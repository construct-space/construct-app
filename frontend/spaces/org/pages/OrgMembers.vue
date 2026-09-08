<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { Users, Plus, Search } from 'lucide-vue-next'
import { Badge, Button, Card, Empty, Input, Pagination, Select } from '@construct-space/ui'
import { useOrgData } from '@/spaces/org/composables/useOrgData'
import { useOrgPermissions } from '@/spaces/org/composables/useOrgPermissions'
import { useSource } from '@/composables/useSource'
import type { MemberStatus, OrgMember } from '@/types/org'
import ToolbarSlot from '@/components/common/ToolbarSlot.vue'

const router = useRouter()
const api = useSource()
const {
  members: allMembers,
  roles: orgRoles,
  searchMembers,
  getDepartmentName,
} = useOrgData()
const { canAddMember } = useOrgPermissions()

const searchQuery = ref('')
const roleFilter = ref<string>('all')
const statusFilter = ref<MemberStatus | 'all'>('all')

// Pagination state. `showAll` switches between server-paged
// (?limit&offset → {items,total}) and the full unpaginated list
// already loaded into useOrgData.members via fetchAll().
const PAGE_SIZE = 20
const page = ref(1)
const showAll = ref(false)
const pagedItems = ref<OrgMember[]>([])
const pagedTotal = ref(0)
const loadingPage = ref(false)

async function loadPage() {
  if (showAll.value) return
  loadingPage.value = true
  try {
    const offset = (page.value - 1) * PAGE_SIZE
    const res = await api.get<{ items: OrgMember[]; total: number }>(
      `/org/members?limit=${PAGE_SIZE}&offset=${offset}`,
    )
    pagedItems.value = Array.isArray(res?.items) ? res.items : []
    pagedTotal.value = res?.total ?? 0
  } finally {
    loadingPage.value = false
  }
}

onMounted(loadPage)
watch(page, loadPage)
watch(showAll, (v) => { if (!v) loadPage() })

// When the user types a search or picks a non-default filter, the
// paged window is too narrow to be useful — auto-flip to "Show all"
// so the filter sees every member.
watch([searchQuery, roleFilter, statusFilter], ([q, r, s]) => {
  if ((q || r !== 'all' || s !== 'all') && !showAll.value) showAll.value = true
})

const sourceMembers = computed(() => (showAll.value ? allMembers.value : pagedItems.value))
const total = computed(() => (showAll.value ? allMembers.value.length : pagedTotal.value))

const roleFilterOptions = computed(() => {
  const options: { value: string; label: string }[] = [{ value: 'all', label: 'All roles' }]
  for (const r of orgRoles.value) {
    options.push({ value: r.name.toLowerCase(), label: r.name })
  }
  return options
})

const statuses: { value: MemberStatus | 'all'; label: string }[] = [
  { value: 'all', label: 'All statuses' },
  { value: 'active', label: 'Active' },
  { value: 'inactive', label: 'Inactive' },
]

const filteredMembers = computed(() => {
  let result = sourceMembers.value
  if (searchQuery.value) {
    const q = searchQuery.value.toLowerCase()
    // searchMembers searches the full list; safe to use here because
    // we auto-flip to showAll when a query is set.
    result = searchMembers(q)
  }
  if (roleFilter.value !== 'all') {
    result = result.filter(m => m.role === roleFilter.value)
  }
  if (statusFilter.value !== 'all') {
    result = result.filter(m => m.status === statusFilter.value)
  }
  return result
})

function goToInvitations() {
  router.push('/app/settings/org-invitations')
}

function getInitials(name: string): string {
  return name
    .split(' ')
    .map(w => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase()
}

function roleBadgeColor(role: string): 'primary' | 'error' | 'info' | 'success' | 'neutral' {
  switch (role) {
    case 'owner': return 'primary'
    case 'admin': return 'error'
    case 'pm': return 'info'
    case 'developer': return 'info'
    case 'member': return 'success'
    default: return 'neutral'
  }
}

function statusDotClass(status: MemberStatus): string {
  switch (status) {
    case 'active': return 'bg-emerald-400'
    case 'inactive': return 'bg-gray-400'
    case 'pending_invite': return 'bg-amber-400'
    default: return 'bg-gray-400'
  }
}
</script>

<template>
  <div class="p-6 space-y-4">
    <ToolbarSlot name="right">
      <Button
        v-if="canAddMember"
        size="xs"
        label="Invite"
        @click="goToInvitations"
      >
        <template #leading>
          <Plus class="size-3.5" />
        </template>
      </Button>
    </ToolbarSlot>
    <!-- Intro -->
    <Card variant="muted">
      <template #header>
        <div class="flex items-start gap-3 min-w-0 flex-1">
          <Users class="size-5 text-[var(--app-muted)] mt-0.5 shrink-0" />
          <div class="min-w-0 flex-1">
            <h3 class="text-sm tracking-[0.08em] uppercase font-normal text-[var(--app-foreground)] leading-tight after:content-['.'] after:text-[var(--app-accent)]">Members <span class="text-[var(--app-muted)]">({{ total }})</span></h3>
            <p class="text-sm text-[var(--app-muted)] mt-0.5">People who belong to this organization.</p>
          </div>
        </div>
      </template>
    </Card>

    <!-- Search + filters -->
    <div class="flex items-center gap-3 flex-wrap">
      <div class="relative flex-1 min-w-[200px]">
        <Search class="size-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--app-muted)] z-10" />
        <Input
          v-model="searchQuery"
          placeholder="Search by name or email…"
          size="sm"
          class="pl-8"
        />
      </div>
      <div class="w-44">
        <Select v-model="roleFilter" :options="roleFilterOptions" size="sm" />
      </div>
      <div class="w-44">
        <Select v-model="statusFilter" :options="statuses" size="sm" />
      </div>
    </div>

    <!-- Empty state -->
    <Card v-if="filteredMembers.length === 0">
      <Empty
        icon="i-lucide-users"
        :title="searchQuery || roleFilter !== 'all' || statusFilter !== 'all' ? 'No matches' : 'No members yet'"
        :description="searchQuery || roleFilter !== 'all' || statusFilter !== 'all' ? 'No members match the current filters.' : 'Add your first member to start building the directory.'"
      >
        <Button v-if="canAddMember" size="sm" label="Invite member" @click="goToInvitations">
          <template #leading>
            <Plus class="size-3.5" />
          </template>
        </Button>
      </Empty>
    </Card>

    <!-- Members table -->
    <Card v-else>
      <div class="-mx-5 -my-5">
        <table class="w-full">
          <thead>
            <tr class="border-b border-[var(--app-border)]">
              <th class="text-left text-[10px] tracking-[0.08em] uppercase font-medium text-[var(--app-muted)] px-4 py-2.5">Name</th>
              <th class="text-left text-[10px] tracking-[0.08em] uppercase font-medium text-[var(--app-muted)] px-4 py-2.5">Email</th>
              <th class="text-left text-[10px] tracking-[0.08em] uppercase font-medium text-[var(--app-muted)] px-4 py-2.5">Role</th>
              <th class="text-left text-[10px] tracking-[0.08em] uppercase font-medium text-[var(--app-muted)] px-4 py-2.5">Department</th>
              <th class="text-left text-[10px] tracking-[0.08em] uppercase font-medium text-[var(--app-muted)] px-4 py-2.5">Status</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-[var(--app-border)]">
            <tr
              v-for="member in filteredMembers"
              :key="member.id"
              class="hover:bg-[var(--app-canvas-bg)] cursor-pointer transition-colors"
              @click="router.push(`/app/settings/org-members/${member.id}`)"
            >
              <td class="px-4 py-2.5">
                <div class="flex items-center gap-2.5">
                  <div class="size-7 rounded-full bg-[color-mix(in_srgb,var(--app-accent)_12%,transparent)] flex items-center justify-center text-xs font-medium text-[var(--app-accent)]">
                    {{ getInitials(member.name) }}
                  </div>
                  <div>
                    <div class="text-sm text-[var(--app-foreground)]">{{ member.name }}</div>
                    <div v-if="member.title" class="text-xs text-[var(--app-muted)]">{{ member.title }}</div>
                  </div>
                </div>
              </td>
              <td class="px-4 py-2.5 text-sm text-[var(--app-muted)]">{{ member.email }}</td>
              <td class="px-4 py-2.5">
                <Badge :color="roleBadgeColor(member.role)" size="xs">{{ member.role }}</Badge>
              </td>
              <td class="px-4 py-2.5 text-sm text-[var(--app-muted)]">
                {{ member.department_id ? getDepartmentName(member.department_id) : '—' }}
              </td>
              <td class="px-4 py-2.5">
                <div class="flex items-center gap-1.5">
                  <div :class="['size-1.5 rounded-full', statusDotClass(member.status)]" />
                  <span class="text-[10px] tracking-[0.08em] uppercase text-[var(--app-muted)]">{{ member.status }}</span>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </Card>

    <!-- Pagination footer -->
    <div v-if="filteredMembers.length > 0" class="flex items-center justify-between gap-3 pt-1">
      <div class="text-xs text-[var(--app-muted)]">
        <span v-if="showAll">Showing all {{ total }}</span>
        <span v-else>
          Showing {{ (page - 1) * PAGE_SIZE + 1 }}–{{ Math.min(page * PAGE_SIZE, total) }} of {{ total }}
        </span>
      </div>
      <div class="flex items-center gap-3">
        <Pagination
          v-if="!showAll && total > PAGE_SIZE"
          v-model="page"
          :total="total"
          :page-count="PAGE_SIZE"
        />
        <Button
          variant="ghost"
          size="xs"
          :label="showAll ? 'Paginate' : 'Show all'"
          @click="showAll = !showAll"
        />
      </div>
    </div>
  </div>
</template>
