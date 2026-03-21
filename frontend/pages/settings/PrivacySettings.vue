<script setup lang="ts">
import FormField from '@/components/ui/FormField.vue'
import Switch from '@/components/ui/Switch.vue'
import {
  useTelemetry,
  isTelemetryEnabled,
  setTelemetryConsent,
} from '@/composables/useTelemetry'

const telemetry = useTelemetry()
const toast = useToast()

const enabled = ref(isTelemetryEnabled())
const stats = ref<{
  sessions: number
  spaces: number
  dateRange: string
} | null>(null)
const loading = ref(true)

async function loadStats() {
  loading.value = true
  try {
    const data = await telemetry.getStoredData()
    if (data) {
      const from = new Date(data.firstRecordedAt).toLocaleDateString()
      const to = new Date().toLocaleDateString()
      stats.value = {
        sessions: data.sessions.total,
        spaces: Object.keys(data.spaceEnterCount).length,
        dateRange: from === to ? from : `${from} — ${to}`,
      }
    }
  } catch {
    stats.value = null
  } finally {
    loading.value = false
  }
}

watch(enabled, (val) => {
  setTelemetryConsent(val)
})

async function clearData() {
  await telemetry.clearStoredData()
  toast.add({ title: 'Telemetry data cleared', color: 'success' })
  await loadStats()
}

onMounted(() => {
  loadStats()
})
</script>

<template>
  <div>
    <div class="flex flex-col gap-6">
      <FormField
        label="Usage Analytics"
        description="Help improve Construct by sharing anonymous usage data. No personal information is collected — only aggregate counters like session count, spaces visited, and features used."
      >
        <Switch v-model="enabled" />
      </FormField>

      <div v-if="!loading && stats" class="flex flex-col gap-3">
        <p class="text-xs font-semibold tracking-wide uppercase text-[var(--app-foreground)]">
          Stored Data
        </p>
        <div class="rounded-lg border border-[var(--app-border)] p-4 space-y-2 text-sm">
          <div class="flex justify-between">
            <span class="text-[var(--app-muted)]">Sessions recorded</span>
            <span class="text-[var(--app-foreground)] font-medium">{{ stats.sessions }}</span>
          </div>
          <div class="flex justify-between">
            <span class="text-[var(--app-muted)]">Spaces visited</span>
            <span class="text-[var(--app-foreground)] font-medium">{{ stats.spaces }}</span>
          </div>
          <div class="flex justify-between">
            <span class="text-[var(--app-muted)]">Date range</span>
            <span class="text-[var(--app-foreground)] font-medium">{{ stats.dateRange }}</span>
          </div>
        </div>

        <button
          type="button"
          class="self-start px-3 py-1.5 text-xs rounded-md border border-[var(--app-border)] text-[var(--app-muted)] hover:text-red-400 hover:border-red-400/50 transition-colors cursor-pointer"
          @click="clearData"
        >
          Clear Data
        </button>
      </div>
    </div>
  </div>
</template>
