<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import {
  History,
  Search,
  UserPlus,
  UserMinus,
  Mail,
  MailX,
  MailCheck,
  Shield,
  Plus,
  Pencil,
  Activity,
  ChevronLeft,
  ChevronRight,
} from 'lucide-vue-next'
import { Button, Card, Empty, Input, Select } from '@construct-space/ui'
import { useOrgData } from '@/spaces/org/composables/useOrgData'
import { useOrgPermissions } from '@/spaces/org/composables/useOrgPermissions'

const { activity, activityTotal, fetchActivity, getMemberName } = useOrgData()
const { canViewActivity } = useOrgPermissions()

const PER_PAGE = 50
const searchQuery = ref('')
const actionFilter = ref('all')
const page = ref(1)

const pageCount = computed(() => Math.max(1, Math.ceil(activityTotal.value / PER_PAGE)))

watch([actionFilter, searchQuery], () => { page.value = 1 })
watch(page, (p) => { fetchActivity(PER_PAGE, (p - 1) * PER_PAGE) }, { immediate: true })

// Filter is keyed on resource_type (or 'all') since that's what the API sends
const actionTypes = [
  { value: 'all', label: 'All types' },
  { value: 'member', label: 'Members' },
  { value: 'department', label: 'Departments' },
  { value: 'team', label: 'Teams' },
  { value: 'invite', label: 'Invitations' },
  { value: 'project', label: 'Projects' },
  { value: 'provider_key', label: 'Provider keys' },
  { value: 'organization', label: 'Organization' },
]

type IconComponent = typeof UserPlus

// Keyed on action string from API
const actionIconMap: Record<string, IconComponent> = {
  created: Plus,
  updated: Pencil,
  deleted: UserMinus,
  added: UserPlus,
  added_member: UserPlus,
  removed: UserMinus,
  removed_member: UserMinus,
  invited: Mail,
  revoked: MailX,
  joined: MailCheck,
  role_changed: Shield,
}

// Keyed on action string
const actionColorMap: Record<string, string> = {
  created: 'text-emerald-400',
  added: 'text-emerald-400',
  added_member: 'text-emerald-400',
  joined: 'text-emerald-400',
  invited: 'text-amber-400',
  updated: 'text-blue-400',
  role_changed: 'text-purple-400',
  deleted: 'text-red-400',
  removed: 'text-red-400',
  removed_member: 'text-red-400',
  revoked: 'text-red-400',
}

const filteredActivity = computed(() => {
  let result = activity.value
  if (actionFilter.value !== 'all') {
    result = result.filter(e => e.resource_type === actionFilter.value)
  }
  if (searchQuery.value) {
    const q = searchQuery.value.toLowerCase()
    result = result.filter(e =>
      e.resource_name.toLowerCase().includes(q)
      || e.action.toLowerCase().includes(q)
      || e.resource_type.toLowerCase().includes(q),
    )
  }
  return result
})

function formatAction(action: string, resourceType: string): string {
  const label = action.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
  const type = resourceType.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
  return `${type} ${label}`
}

function formatTimestamp(iso: string): string {
  const d = new Date(iso)
  const now = new Date()
  const diff = now.getTime() - d.getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'Just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function formatFullTimestamp(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function getPerformerName(performed_by: string): string {
  if (!performed_by || performed_by === 'current-user') return 'You'
  return getMemberName(performed_by)
}
</script>

<template>
  <!-- No access -->
  <div v-if="!canViewActivity" class="p-6">
    <Card>
      <Empty
        icon="i-lucide-lock"
        title="No access"
        description="You don't have permission to view activity."
      />
    </Card>
  </div>

  <div v-else class="p-6 space-y-4">
    <!-- Intro -->
    <Card variant="muted">
      <template #header>
        <div class="flex items-start gap-3 min-w-0 flex-1">
          <Activity class="size-5 text-[var(--app-muted)] mt-0.5 shrink-0" />
          <div class="min-w-0 flex-1">
            <h3 class="text-sm tracking-[0.08em] uppercase font-normal text-[var(--app-foreground)] leading-tight after:content-['.'] after:text-[var(--app-accent)]">Activity <span v-if="activityTotal" class="text-[var(--app-muted)]">({{ activityTotal }})</span></h3>
            <p class="text-sm text-[var(--app-muted)] mt-0.5">Audit log of changes across members, departments, teams, and invitations.</p>
          </div>
        </div>
      </template>
    </Card>

    <!-- Filters -->
    <Card>
      <template #header>
        <div class="flex items-start gap-3">
          <History class="size-5 text-[var(--app-muted)] mt-0.5 shrink-0" />
          <div class="min-w-0 flex-1">
            <h4 class="text-sm tracking-[0.08em] uppercase font-normal text-[var(--app-foreground)] leading-tight after:content-['.'] after:text-[var(--app-accent)]">Filters</h4>
            <p class="text-xs text-[var(--app-muted)] mt-0.5">Narrow down the feed by action type or resource name.</p>
          </div>
        </div>
      </template>

      <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <label class="block text-[10px] tracking-[0.08em] uppercase text-[var(--app-muted)] mb-1">Search</label>
          <div class="relative">
            <Search class="size-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--app-muted)] z-10" />
            <Input
              v-model="searchQuery"
              size="sm"
              placeholder="Resource name or action"
              class="[&_input]:pl-9"
            />
          </div>
        </div>
        <div>
          <label class="block text-[10px] tracking-[0.08em] uppercase text-[var(--app-muted)] mb-1">Action type</label>
          <Select v-model="actionFilter" :options="actionTypes" size="sm" />
        </div>
      </div>
    </Card>

    <!-- Activity list -->
    <Card v-if="filteredActivity.length === 0">
      <Empty
        icon="i-lucide-activity"
        :title="activity.length === 0 ? 'No activity yet' : 'No matches'"
        :description="activity.length === 0 ? 'Activity will appear here as changes happen in this organization.' : 'No activity matches the current filters.'"
      />
    </Card>

    <Card v-else>
      <div class="-mx-5 -my-5">
        <div class="divide-y divide-[var(--app-border)]">
          <div
            v-for="entry in filteredActivity"
            :key="entry.id"
            class="px-5 py-3 flex items-start gap-3"
          >
            <div class="mt-0.5 shrink-0">
              <component
                :is="actionIconMap[entry.action] || Pencil"
                class="size-3.5"
                :class="actionColorMap[entry.action] || 'text-[var(--app-muted)]'"
              />
            </div>
            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-2 flex-wrap">
                <span class="text-sm text-[var(--app-foreground)]">{{ formatAction(entry.action, entry.resource_type) }}</span>
                <span class="text-sm text-[var(--app-muted)]">—</span>
                <span class="text-sm font-medium text-[var(--app-foreground)]">{{ entry.resource_name }}</span>
              </div>
              <div class="flex items-center gap-2 mt-0.5">
                <span class="text-xs text-[var(--app-muted)]">by {{ getPerformerName(entry.performed_by) }}</span>
              </div>
            </div>
            <span
              class="text-[10px] tracking-[0.08em] uppercase text-[var(--app-muted)] shrink-0"
              :title="formatFullTimestamp(entry.created_at)"
            >
              {{ formatTimestamp(entry.created_at) }}
            </span>
          </div>
        </div>
      </div>

      <template v-if="pageCount > 1" #footer>
        <span class="text-[10px] tracking-[0.08em] uppercase text-[var(--app-muted)]">
          Page <strong class="text-[var(--app-foreground)]">{{ page }}</strong> of {{ pageCount }}
          · {{ activityTotal }} total
        </span>
      </template>
      <template v-if="pageCount > 1" #footer-end>
        <div class="flex items-center gap-1">
          <Button variant="ghost" size="xs" :disabled="page <= 1" @click="page--">
            <template #leading><ChevronLeft class="size-3.5" /></template>
            Prev
          </Button>
          <Button variant="ghost" size="xs" :disabled="page >= pageCount" @click="page++">
            Next
            <template #trailing><ChevronRight class="size-3.5" /></template>
          </Button>
        </div>
      </template>
    </Card>
  </div>
</template>
