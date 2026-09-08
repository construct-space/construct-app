<script setup lang="ts">
/**
 * OrgInsights — Admin-only aggregated org metrics.
 */
import { useOrgData } from '../composables/useOrgData'
import { useOrgPermissions } from '../composables/useOrgPermissions'
import { useSource } from '@/composables/useSource'
import { Users, FolderOpen, Cpu, Building2, GitBranch, Mail, BarChart3, Loader2 } from 'lucide-vue-next'
import { Card, Empty } from '@construct-space/ui'

const { org: _org } = useOrgData()
const { isAdmin } = useOrgPermissions()
const api = useSource()

const insights = ref<{
  members: number
  active_members: number
  projects: number
  providers: number
  departments: number
  teams: number
  pending_invites: number
} | null>(null)

const loading = ref(true)

onMounted(async () => {
  if (!isAdmin.value) { loading.value = false; return }
  try {
    insights.value = await api.get('/org/insights')
  } catch { /* silent */ }
  loading.value = false
})

const stats = computed(() => {
  if (!insights.value) return []
  return [
    { label: 'Members', value: insights.value.members, active: insights.value.active_members, icon: Users },
    { label: 'Projects', value: insights.value.projects, icon: FolderOpen },
    { label: 'Providers', value: insights.value.providers, icon: Cpu },
    { label: 'Departments', value: insights.value.departments, icon: Building2 },
    { label: 'Teams', value: insights.value.teams, icon: GitBranch },
    { label: 'Pending Invites', value: insights.value.pending_invites, icon: Mail },
  ]
})
</script>

<template>
  <div class="p-6 space-y-4">
    <!-- Intro -->
    <Card variant="muted">
      <template #header>
        <div class="flex items-start gap-3">
          <BarChart3 class="size-5 text-[var(--app-muted)] mt-0.5 shrink-0" />
          <div class="min-w-0 flex-1">
            <h3 class="text-sm tracking-[0.08em] uppercase font-normal text-[var(--app-foreground)] leading-tight after:content-['.'] after:text-[var(--app-accent)]">Organization insights</h3>
            <p class="text-sm text-[var(--app-muted)] mt-0.5">Aggregate metrics across members, projects, and infrastructure.</p>
          </div>
        </div>
      </template>
    </Card>

    <!-- No access -->
    <Card v-if="!isAdmin">
      <Empty
        icon="i-lucide-lock"
        title="Admins only"
        description="Insights are only available to organization admins."
      />
    </Card>

    <!-- Loading -->
    <div v-else-if="loading" class="flex justify-center py-12">
      <Loader2 class="size-5 animate-spin text-[var(--app-muted)]" />
    </div>

    <!-- Empty -->
    <Card v-else-if="!insights">
      <Empty
        icon="i-lucide-bar-chart-3"
        title="No insights available"
        description="There is no data to display for this organization yet."
      />
    </Card>

    <!-- Stat tiles -->
    <div v-else class="grid grid-cols-2 md:grid-cols-3 gap-3">
      <Card v-for="stat in stats" :key="stat.label">
        <template #header>
          <div class="flex items-center gap-2">
            <component :is="stat.icon" class="size-4 text-[var(--app-muted)]" />
            <span class="text-[10px] tracking-[0.08em] uppercase text-[var(--app-muted)]">{{ stat.label }}</span>
          </div>
        </template>
        <div class="text-2xl font-normal text-[var(--app-foreground)] tabular-nums">{{ stat.value }}</div>
        <template v-if="'active' in stat && stat.active !== undefined" #footer>
          <span class="text-[10px] tracking-[0.08em] uppercase text-[var(--app-muted)]">{{ stat.active }} active</span>
        </template>
      </Card>
    </div>
  </div>
</template>
