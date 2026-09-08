<script setup lang="ts">
/**
 * InsightsSettings — AI usage analytics dashboard.
 */
import { ref, computed, onMounted } from 'vue'
import { useBrain } from '@/brain'
import { Button, Card, Empty, Select } from '@construct-space/ui'
import { BarChart3, Loader2 } from 'lucide-vue-next'

interface AgentUsage {
  agent_id: string
  sessions: number
  turns: number
  cost_usd: number
}

interface DailySummary {
  date: string
  sessions: number
  total_turns: number
  total_tokens: number
  total_cost_usd: number
}

interface SessionRecord {
  id: string
  agent_id: string
  start_time: string
  duration_secs: number
  turns: number
  cost_usd: number
  stop_reason: string
}

interface OverviewStats {
  total_sessions: number
  total_turns: number
  total_tokens: number
  total_cost_usd: number
  avg_turns_per_session: number
  avg_cost_per_session: number
  top_agents: AgentUsage[]
  daily_history: DailySummary[]
  recent_sessions: SessionRecord[]
}

const brain = useBrain()
const stats = ref<OverviewStats | null>(null)
const loading = ref(false)
const days = ref(30)

const rangeOptions = [
  { label: 'Last 7 days', value: 7 },
  { label: 'Last 30 days', value: 30 },
  { label: 'Last 90 days', value: 90 },
]

async function loadStats() {
  loading.value = true
  try {
    const result = await brain.request<OverviewStats>('insights.overview', { days: days.value })
    stats.value = result
  } catch {
    stats.value = null
  } finally {
    loading.value = false
  }
}

function formatCost(usd: number): string {
  if (usd < 0.01) return '<$0.01'
  return `$${usd.toFixed(2)}`
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`
  return String(n)
}

function relativeTime(ts: string): string {
  const diff = Date.now() - new Date(ts).getTime()
  if (diff < 60000) return 'Just now'
  if (diff < 3600000) return `${Math.round(diff / 60000)}m ago`
  if (diff < 86400000) return `${Math.round(diff / 3600000)}h ago`
  return `${Math.round(diff / 86400000)}d ago`
}

const sparkBars = computed(() => {
  if (!stats.value?.daily_history?.length) return []
  const history = stats.value.daily_history
  const maxSessions = Math.max(...history.map(d => d.sessions), 1)
  return history.slice(-21).map(d => ({
    height: Math.max(4, (d.sessions / maxSessions) * 100),
    label: `${d.date}: ${d.sessions} sessions, ${formatCost(d.total_cost_usd)}`,
    date: d.date.slice(5),
  }))
})

onMounted(loadStats)
</script>

<template>
  <div class="space-y-4">
    <!-- Intro -->
    <Card variant="muted">
      <template #header>
        <div class="flex items-start gap-3">
          <BarChart3 class="size-5 text-[var(--app-muted)] mt-0.5 shrink-0" />
          <div class="min-w-0 flex-1">
            <h3 class="text-sm tracking-[0.08em] uppercase font-normal text-[var(--app-foreground)] leading-tight after:content-['.'] after:text-[var(--app-accent)]">AI Insights</h3>
            <p class="text-sm text-[var(--app-muted)] mt-0.5">Session analytics, costs, and usage trends</p>
          </div>
        </div>
      </template>
      <template #accessory>
        <div class="flex items-center gap-2">
          <div class="w-40">
            <Select
              :model-value="days"
              :options="rangeOptions"
              size="sm"
              :placeholder="''"
              @update:model-value="days = Number($event); loadStats()"
            />
          </div>
          <Button
            variant="ghost"
            color="neutral"
            size="xs"
            icon="lucide:refresh-cw"
            :loading="loading"
            @click="loadStats()"
          />
        </div>
      </template>
    </Card>

    <!-- Loading -->
    <div v-if="loading && !stats" class="flex justify-center py-12">
      <Loader2 class="size-5 animate-spin text-[var(--app-muted)]" />
    </div>

    <!-- Empty -->
    <Empty
      v-else-if="!stats || stats.total_sessions === 0"
      icon="lucide:bar-chart-3"
      title="No session data yet"
      description="Analytics will appear here after you use agents"
    />

    <template v-else>
      <!-- Stat tiles -->
      <div class="grid grid-cols-4 gap-3">
        <Card title="Sessions">
          <div class="text-2xl font-normal text-[var(--app-foreground)] tabular-nums">{{ stats.total_sessions }}</div>
          <template #footer>
            <span class="text-[10px] text-[var(--app-muted)]">{{ stats.avg_turns_per_session.toFixed(1) }} avg turns</span>
          </template>
        </Card>

        <Card title="Total Cost">
          <div class="text-2xl font-normal text-[var(--app-foreground)] tabular-nums">{{ formatCost(stats.total_cost_usd) }}</div>
          <template #footer>
            <span class="text-[10px] text-[var(--app-muted)]">{{ formatCost(stats.avg_cost_per_session) }} avg/session</span>
          </template>
        </Card>

        <Card title="Tokens">
          <div class="text-2xl font-normal text-[var(--app-foreground)] tabular-nums">{{ formatTokens(stats.total_tokens) }}</div>
          <template #footer>
            <span class="text-[10px] text-[var(--app-muted)]">{{ stats.total_turns }} total turns</span>
          </template>
        </Card>

        <Card title="Turns">
          <div class="text-2xl font-normal text-[var(--app-foreground)] tabular-nums">{{ stats.total_turns }}</div>
          <template #footer>
            <span class="text-[10px] text-[var(--app-muted)]">across {{ stats.total_sessions }} sessions</span>
          </template>
        </Card>
      </div>

      <!-- Activity chart -->
      <Card v-if="sparkBars.length > 1" title="Daily Activity">
        <div class="space-y-2">
          <div class="flex items-end gap-1 h-32">
            <div
              v-for="(bar, i) in sparkBars"
              :key="i"
              class="flex-1 rounded-sm bg-[var(--app-accent)]/60 hover:bg-[var(--app-accent)] transition-colors cursor-default min-w-0"
              :style="{ height: bar.height + '%' }"
              :title="bar.label"
            />
          </div>
          <div class="flex gap-1">
            <span
              v-for="(bar, i) in sparkBars"
              :key="i"
              class="flex-1 text-center text-[9px] text-[var(--app-muted)]/60 tracking-[0.08em] uppercase min-w-0"
            >
              {{ i % 3 === 0 ? bar.date : '' }}
            </span>
          </div>
        </div>
      </Card>

      <!-- Agent usage -->
      <Card v-if="stats.top_agents?.length" title="Agent Usage">
        <div class="space-y-2">
          <div
            v-for="agent in stats.top_agents"
            :key="agent.agent_id"
            class="flex items-center gap-3"
          >
            <span class="text-xs font-normal text-[var(--app-foreground)] w-20 truncate">{{ agent.agent_id }}</span>
            <div class="flex-1 h-2 rounded-sm bg-[var(--app-foreground)]/5 overflow-hidden">
              <div
                class="h-full rounded-sm bg-[var(--app-accent)]/70"
                :style="{ width: Math.max(4, (agent.sessions / stats.total_sessions) * 100) + '%' }"
              />
            </div>
            <span class="text-[10px] text-[var(--app-muted)] w-24 text-right">
              {{ agent.sessions }} sess / {{ formatCost(agent.cost_usd) }}
            </span>
          </div>
        </div>
      </Card>

      <!-- Recent sessions -->
      <Card v-if="stats.recent_sessions?.length" title="Recent Sessions">
        <div class="space-y-1.5">
          <div
            v-for="sess in stats.recent_sessions"
            :key="sess.id"
            class="flex items-center gap-3 text-xs py-1.5 border-b border-[var(--app-border)]/30 last:border-0"
          >
            <span class="font-mono text-[var(--app-foreground)]/50 w-16">{{ sess.id.slice(0, 8) }}</span>
            <span class="font-normal text-[var(--app-foreground)] w-16">{{ sess.agent_id }}</span>
            <span class="text-[var(--app-muted)]">{{ sess.turns }} turns</span>
            <span class="text-[var(--app-muted)]">{{ formatCost(sess.cost_usd) }}</span>
            <span class="flex-1" />
            <span class="text-[var(--app-muted)]/60">{{ relativeTime(sess.start_time) }}</span>
          </div>
        </div>
      </Card>
    </template>
  </div>
</template>
