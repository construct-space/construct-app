<script setup lang="ts">
import { Button, Card, Switch } from '@construct-space/ui'

import {
  useTelemetry,
  isTelemetryEnabled,
  setTelemetryConsent,
} from '@/composables/useTelemetry'

const telemetry = useTelemetry()
const toast = useNotification()

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
      stats.value = {
        sessions: data.sessions,
        spaces: data.spaces,
        dateRange: data.dateRange,
      }
    }
  } catch {
    stats.value = null
  } finally {
    loading.value = false
  }
}

watch(enabled, (val) => {
  setTelemetryConsent(val ? 'anonymous' : 'off')
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
  <div class="space-y-4">
    <!-- Usage Analytics toggle -->
    <Card
      title="Usage Analytics"
      description="Help improve Construct by sharing anonymous usage data. No personal information is collected — only aggregate counters like session count, spaces visited, and features used."
    >
      <template #accessory>
        <Switch v-model="enabled" />
      </template>
    </Card>

    <!-- Stored Data -->
    <Card v-if="!loading && stats" title="Stored Data">
      <div class="space-y-2 text-sm">
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

      <template #footer-end>
        <Button variant="outline" color="error" size="xs" label="Clear Data" @click="clearData" />
      </template>
    </Card>
  </div>
</template>
