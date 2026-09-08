<script setup lang="ts">
import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import { Users, Building2, Briefcase, Mail, Plus, UserPlus, ArrowRight, LayoutDashboard, Activity } from 'lucide-vue-next'
import { Button, Card, Empty, Input } from '@construct-space/ui'
import { useOrgData } from '@/spaces/org/composables/useOrgData'
import { useOrgPermissions } from '@/spaces/org/composables/useOrgPermissions'

const router = useRouter()
const {
  isEnabled,
  orgName,
  stats,
  recentActivity,
  enableOrg,
} = useOrgData()
const { canAddMember, canManageDepartments, canManageInvites } = useOrgPermissions()

const setupName = ref('')
const recentEntries = computed(() => recentActivity(10))

function handleEnable() {
  const name = setupName.value.trim()
  if (!name) return
  enableOrg(name)
}

function formatAction(action: string): string {
  return action.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

function formatDate(iso: string): string {
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
  return d.toLocaleDateString()
}

const statCards = computed(() => [
  { label: 'Members', value: stats.value.memberCount, icon: Users, route: '/app/settings/org-members' },
  { label: 'Departments', value: stats.value.departmentCount, icon: Building2, route: '/app/settings/org-departments' },
  { label: 'Teams', value: stats.value.teamCount, icon: Briefcase, route: '' },
  { label: 'Pending Invites', value: stats.value.pendingInviteCount, icon: Mail, route: '/app/settings/org-invitations' },
])
</script>

<template>
  <!-- Setup prompt when org is not enabled -->
  <div v-if="!isEnabled" class="p-6 max-w-xl mx-auto">
    <Card>
      <template #header>
        <div class="flex items-start gap-3">
          <Building2 class="size-5 text-[var(--app-muted)] mt-0.5 shrink-0" />
          <div class="min-w-0 flex-1">
            <h3 class="text-sm tracking-[0.08em] uppercase font-normal text-[var(--app-foreground)] leading-tight after:content-['.'] after:text-[var(--app-accent)]">Set up your organization</h3>
            <p class="text-xs text-[var(--app-muted)] mt-0.5">Create an organization to manage members, departments, teams, and invitations.</p>
          </div>
        </div>
      </template>

      <div>
        <label class="block text-[10px] tracking-[0.08em] uppercase text-[var(--app-muted)] mb-1">Organization name</label>
        <Input
          v-model="setupName"
          size="sm"
          placeholder="Acme Corp"
          @keydown.enter="handleEnable"
        />
      </div>

      <template #footer-end>
        <Button
          size="sm"
          label="Enable organization"
          :disabled="!setupName.trim()"
          @click="handleEnable"
        />
      </template>
    </Card>
  </div>

  <!-- Dashboard when org is enabled -->
  <div v-else class="p-6 space-y-4">
    <!-- Intro -->
    <Card variant="muted">
      <template #header>
        <div class="flex items-start gap-3">
          <LayoutDashboard class="size-5 text-[var(--app-muted)] mt-0.5 shrink-0" />
          <div class="min-w-0 flex-1">
            <h3 class="text-sm tracking-[0.08em] uppercase font-normal text-[var(--app-foreground)] leading-tight after:content-['.'] after:text-[var(--app-accent)]">{{ orgName }}</h3>
            <p class="text-sm text-[var(--app-muted)] mt-0.5">Overview of members, departments, teams, and recent activity.</p>
          </div>
        </div>
      </template>
    </Card>

    <!-- Stats cards -->
    <div class="grid grid-cols-2 lg:grid-cols-4 gap-3">
      <Card
        v-for="card in statCards"
        :key="card.label"
        interactive
        @click="card.route && router.push(card.route)"
      >
        <template #header>
          <div class="flex items-center gap-2">
            <component :is="card.icon" class="size-4 text-[var(--app-muted)]" />
            <span class="text-[10px] tracking-[0.08em] uppercase text-[var(--app-muted)]">{{ card.label }}</span>
          </div>
        </template>
        <div class="text-2xl font-normal text-[var(--app-foreground)] tabular-nums">{{ card.value }}</div>
      </Card>
    </div>

    <!-- Quick actions -->
    <Card>
      <template #header>
        <div class="min-w-0 flex-1">
          <h4 class="text-sm tracking-[0.08em] uppercase font-normal text-[var(--app-foreground)] leading-tight after:content-['.'] after:text-[var(--app-accent)]">Quick actions</h4>
          <p class="text-xs text-[var(--app-muted)] mt-0.5">Jump directly into common org tasks.</p>
        </div>
      </template>

      <div class="flex items-center gap-2 flex-wrap">
        <Button
          v-if="canAddMember"
          size="sm"
          label="Add member"
          @click="router.push('/app/settings/org-members')"
        >
          <template #leading>
            <UserPlus class="size-3.5" />
          </template>
        </Button>
        <Button
          v-if="canManageDepartments"
          variant="ghost"
          size="sm"
          label="Add department"
          @click="router.push('/app/settings/org-departments')"
        >
          <template #leading>
            <Plus class="size-3.5" />
          </template>
        </Button>
        <Button
          v-if="canManageInvites"
          variant="ghost"
          size="sm"
          label="Send invite"
          @click="router.push('/app/settings/org-invitations')"
        >
          <template #leading>
            <Mail class="size-3.5" />
          </template>
        </Button>
      </div>
    </Card>

    <!-- Recent activity -->
    <Card>
      <template #header>
        <div class="flex items-start gap-3">
          <Activity class="size-5 text-[var(--app-muted)] mt-0.5 shrink-0" />
          <div class="min-w-0 flex-1">
            <h4 class="text-sm tracking-[0.08em] uppercase font-normal text-[var(--app-foreground)] leading-tight after:content-['.'] after:text-[var(--app-accent)]">Recent activity</h4>
            <p class="text-xs text-[var(--app-muted)] mt-0.5">Latest changes across this organization.</p>
          </div>
        </div>
      </template>
      <template v-if="recentEntries.length > 0" #accessory>
        <Button
          variant="ghost"
          size="xs"
          label="View all"
          @click="router.push('/app/settings/org-activity')"
        >
          <template #trailing>
            <ArrowRight class="size-3.5" />
          </template>
        </Button>
      </template>

      <Empty
        v-if="recentEntries.length === 0"
        icon="i-lucide-activity"
        title="No activity yet"
        description="Start by adding members or departments."
      />

      <div v-else class="-mx-5 -my-5">
        <div class="divide-y divide-[var(--app-border)]">
          <div
            v-for="entry in recentEntries"
            :key="entry.id"
            class="px-5 py-2.5 flex items-center justify-between gap-3"
          >
            <div class="flex items-center gap-3 min-w-0">
              <div class="size-1.5 rounded-full bg-[var(--app-accent)] shrink-0" />
              <div class="min-w-0 truncate">
                <span class="text-sm text-[var(--app-foreground)]">{{ formatAction(entry.action) }}</span>
                <span class="text-sm text-[var(--app-muted)]"> — {{ entry.resource_name }}</span>
              </div>
            </div>
            <span class="text-[10px] tracking-[0.08em] uppercase text-[var(--app-muted)] shrink-0">{{ formatDate(entry.created_at) }}</span>
          </div>
        </div>
      </div>
    </Card>
  </div>
</template>
