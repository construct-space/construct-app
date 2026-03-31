<script setup lang="ts">
/**
 * SpacesSettings — Manage installed marketplace spaces
 *
 * Lists installed marketplace spaces with enable/disable toggles,
 * version info, update indicators, and uninstall buttons.
 */

import { useSpaceMarketplace } from '@/composables/useSpaceMarketplace'
import { IS_DEV_INSTANCE } from '@/lib/appPaths'
import { spaceDoctor, type SpaceHealthReport, type SpaceHealthStatus } from '@/space_loader/spaceDoctor'
import { getErrorActions } from '@/space_loader/errorActions'
import {
  RefreshCw, Trash2, ToggleLeft, ToggleRight,
  Download, Store, ExternalLink, Box,
  HeartPulse, CheckCircle2, AlertTriangle, XCircle, Loader2,
} from 'lucide-vue-next'

const router = useRouter()
const toast = useNotification()
const marketplace = useSpaceMarketplace()

const confirmUninstall = ref<string | null>(null)

// Space health state
const healthReports = ref<SpaceHealthReport[]>([])
const healthChecking = ref(false)
const healthChecked = ref(false)

const healthStatusIcon = (status: SpaceHealthStatus) => {
  switch (status) {
    case 'healthy': return CheckCircle2
    case 'warning': return AlertTriangle
    case 'error': return XCircle
  }
}

const healthStatusColor = (status: SpaceHealthStatus) => {
  switch (status) {
    case 'healthy': return 'text-green-400'
    case 'warning': return 'text-amber-400'
    case 'error': return 'text-red-400'
  }
}

async function handleCheckHealth() {
  healthChecking.value = true
  try {
    healthReports.value = await spaceDoctor()
    healthChecked.value = true
    const errors = healthReports.value.filter(r => r.status === 'error').length
    const warnings = healthReports.value.filter(r => r.status === 'warning').length
    if (errors > 0) {
      toast.add({ title: `${errors} space(s) with errors`, color: 'error' })
    } else if (warnings > 0) {
      toast.add({ title: `${warnings} space(s) with warnings`, color: 'warning' })
    } else {
      toast.add({ title: 'All spaces healthy', color: 'success' })
    }
  } catch (e) {
    toast.add({ title: 'Health check failed', color: 'error' })
  } finally {
    healthChecking.value = false
  }
}

function handleFixAction(route?: string) {
  if (route) router.push(route)
}

onMounted(async () => {
  await marketplace.fetchInstalled()
})

async function handleToggle(spaceId: string, currentlyEnabled: boolean) {
  if (currentlyEnabled) {
    await marketplace.disable(spaceId)
  } else {
    await marketplace.enable(spaceId)
  }
}

async function handleUpdate(spaceId: string) {
  await marketplace.update(spaceId)
}

async function handleUninstall(spaceId: string) {
  await marketplace.uninstall(spaceId)
  confirmUninstall.value = null
}

async function handleCheckUpdates() {
  await marketplace.checkUpdates()
}

async function handleOpenConstructDev() {
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    await invoke('open_construct_dev')
  } catch (error) {
    toast.add({
      title: 'Construct DEV not available',
      description: String(error || 'Install Construct DEV to open the isolated space builder.'),
      color: 'warning',
    })
  }
}
</script>

<template>
  <div class="space-y-8">
    <!-- Header -->
    <div class="flex items-center justify-between">
      <div>
        <h2 class="text-lg font-semibold text-[var(--app-foreground)]">Spaces</h2>
        <p class="text-sm text-[var(--app-muted)] mt-0.5">Manage installed marketplace spaces</p>
      </div>
      <div class="flex gap-2">
        <button v-if="!IS_DEV_INSTANCE"
          class="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium border border-orange-400/25 text-orange-300 hover:bg-orange-500/10 transition-colors"
          @click="handleOpenConstructDev">
          <ExternalLink class="size-3" />
          Open Construct DEV
        </button>
        <button
          class="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium border border-[var(--app-border)] text-[var(--app-foreground)] hover:bg-[color-mix(in_srgb,var(--app-muted)_5%,transparent)] transition-colors"
          :disabled="healthChecking"
          @click="handleCheckHealth">
          <Loader2 v-if="healthChecking" class="size-3 animate-spin" />
          <HeartPulse v-else class="size-3" />
          Check Health
        </button>
        <button
          class="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium border border-[var(--app-border)] text-[var(--app-foreground)] hover:bg-[color-mix(in_srgb,var(--app-muted)_5%,transparent)] transition-colors"
          @click="handleCheckUpdates">
          <RefreshCw class="size-3" />
          Check Updates
        </button>
        <button
          class="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-[var(--app-accent)] text-white hover:opacity-90 transition-opacity"
          @click="router.push('/app/marketplace')">
          <Store class="size-3" />
          Browse Marketplace
        </button>
      </div>
    </div>

    <!-- Space Health Results -->
    <div v-if="healthChecked && healthReports.length > 0" class="space-y-2">
      <div class="flex items-center gap-2 mb-3">
        <HeartPulse class="size-4 text-[var(--app-accent)]" />
        <p class="text-sm font-medium text-[var(--app-foreground)]">Space Health</p>
      </div>
      <div v-for="report in healthReports" :key="report.spaceId"
        class="p-3 rounded-lg border border-[var(--app-border)]">
        <div class="flex items-center gap-3">
          <component :is="healthStatusIcon(report.status)" class="size-4 shrink-0" :class="healthStatusColor(report.status)" />
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2">
              <span class="text-sm font-medium text-[var(--app-foreground)]">{{ report.name }}</span>
              <span class="text-[10px] text-[var(--app-muted)] bg-[color-mix(in_srgb,var(--app-muted)_8%,transparent)] px-1.5 py-0.5 rounded">
                v{{ report.version }}
              </span>
              <span v-if="report.isCore" class="text-[10px] text-[var(--app-accent)] bg-[color-mix(in_srgb,var(--app-accent)_8%,transparent)] px-1.5 py-0.5 rounded">
                core
              </span>
            </div>
            <!-- Issues -->
            <div v-if="report.issues.length > 0" class="mt-2 space-y-1.5">
              <div v-for="(issue, idx) in report.issues" :key="idx" class="text-xs">
                <p :class="issue.severity === 'error' ? 'text-red-400' : 'text-amber-400'">
                  {{ issue.message }}
                </p>
                <div class="flex flex-wrap gap-1.5 mt-1">
                  <button
                    v-for="action in getErrorActions(issue.phase)"
                    :key="action.label"
                    class="px-2 py-0.5 rounded text-[10px] font-medium border transition-colors"
                    :class="action.type === 'navigate'
                      ? 'border-[var(--app-accent)]/30 text-[var(--app-accent)] hover:bg-[color-mix(in_srgb,var(--app-accent)_10%,transparent)]'
                      : 'border-[var(--app-border)] text-[var(--app-muted)] hover:text-[var(--app-foreground)]'"
                    :title="action.description"
                    @click="handleFixAction(action.route)"
                  >
                    {{ action.label }}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Installed spaces list -->
    <div v-if="marketplace.installed.value.length > 0" class="space-y-2">
      <div v-for="space in marketplace.installed.value" :key="space.id"
        class="flex items-center gap-4 p-4 rounded-lg border border-[var(--app-border)]">
        <!-- Icon + info -->
        <div
          class="size-10 rounded-lg bg-[color-mix(in_srgb,var(--app-accent)_10%,transparent)] flex items-center justify-center shrink-0">
          <Box class="size-5 text-[var(--app-accent)]" />
        </div>
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-2">
            <span class="text-sm font-medium text-[var(--app-foreground)]">{{ space.display_name }}</span>
            <span
              class="text-[10px] text-[var(--app-muted)] bg-[color-mix(in_srgb,var(--app-muted)_8%,transparent)] px-1.5 py-0.5 rounded">
              v{{ space.version }}
            </span>
            <span v-if="space.has_update"
              class="text-[10px] font-semibold text-amber-400 bg-amber-400/10 px-1.5 py-0.5 rounded">
              Update available{{ space.latest_version ? ` (v${space.latest_version})` : '' }}
            </span>
          </div>
          <p class="text-xs text-[var(--app-muted)] mt-0.5">
            Installed {{ new Date(space.installed_at).toLocaleDateString() }}
          </p>
        </div>

        <!-- Actions -->
        <div class="flex items-center gap-2 shrink-0">
          <!-- Update button -->
          <button v-if="space.has_update" class="p-2 rounded-md text-amber-400 hover:bg-amber-400/10 transition-colors"
            title="Update" @click="handleUpdate(space.id)">
            <Download class="size-4" />
          </button>

          <!-- Enable/disable toggle -->
          <button class="p-2 rounded-md transition-colors" :class="space.enabled
            ? 'text-[var(--app-accent)] hover:bg-[color-mix(in_srgb,var(--app-accent)_8%,transparent)]'
            : 'text-[var(--app-muted)] hover:bg-[color-mix(in_srgb,var(--app-muted)_8%,transparent)]'"
            :title="space.enabled ? 'Disable' : 'Enable'" @click="handleToggle(space.id, space.enabled)">
            <component :is="space.enabled ? ToggleRight : ToggleLeft" class="size-5" />
          </button>

          <!-- Uninstall -->
          <button v-if="confirmUninstall !== space.id"
            class="p-2 rounded-md text-[var(--app-muted)] hover:text-red-400 hover:bg-red-400/10 transition-colors"
            title="Uninstall" @click="confirmUninstall = space.id">
            <Trash2 class="size-4" />
          </button>
          <div v-else class="flex items-center gap-1">
            <button
              class="px-2 py-1 rounded text-xs font-medium text-red-400 bg-red-400/10 hover:bg-red-400/20 transition-colors"
              @click="handleUninstall(space.id)">
              Confirm
            </button>
            <button
              class="px-2 py-1 rounded text-xs text-[var(--app-muted)] hover:bg-[color-mix(in_srgb,var(--app-muted)_8%,transparent)] transition-colors"
              @click="confirmUninstall = null">
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Empty state -->
    <div v-else class="text-center py-16 border border-dashed border-[var(--app-border)] rounded-lg">
      <Store class="size-10 text-[var(--app-muted)] mx-auto mb-3 opacity-40" />
      <p class="text-sm text-[var(--app-muted)]">No marketplace spaces installed</p>
      <p class="text-xs text-[var(--app-muted)] mt-1">Browse the marketplace to discover and install new spaces</p>
      <button
        class="mt-4 px-4 py-2 rounded-lg bg-[var(--app-accent)] text-white text-sm font-medium hover:opacity-90 transition-opacity"
        @click="router.push('/app/marketplace')">
        Browse Marketplace
      </button>
    </div>
  </div>
</template>
