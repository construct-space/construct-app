<script setup lang="ts">
/**
 * SpacesSettings — Manage installed marketplace spaces
 *
 * Lists installed marketplace spaces with enable/disable toggles,
 * version info, update indicators, and uninstall buttons.
 */

import { useSpaceMarketplace } from '@/composables/useSpaceMarketplace'
import { IS_DEV_INSTANCE } from '@/lib/appPaths'
import {
  RefreshCw, Trash2, ToggleLeft, ToggleRight,
  Download, Store, ExternalLink,
} from 'lucide-vue-next'

const router = useRouter()
const toast = useToast()
const marketplace = useSpaceMarketplace()

const confirmUninstall = ref<string | null>(null)

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
        <button
          v-if="!IS_DEV_INSTANCE"
          class="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium border border-orange-400/25 text-orange-300 hover:bg-orange-500/10 transition-colors"
          @click="handleOpenConstructDev"
        >
          <ExternalLink class="size-3" />
          Open Construct DEV
        </button>
        <button
          class="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium border border-[var(--app-border)] text-[var(--app-foreground)] hover:bg-[color-mix(in_srgb,var(--app-muted)_5%,transparent)] transition-colors"
          @click="handleCheckUpdates"
        >
          <RefreshCw class="size-3" />
          Check Updates
        </button>
        <button
          class="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-[var(--app-accent)] text-white hover:opacity-90 transition-opacity"
          @click="router.push('/app/marketplace')"
        >
          <Store class="size-3" />
          Browse Marketplace
        </button>
      </div>
    </div>

    <!-- Installed spaces list -->
    <div v-if="marketplace.installed.value.length > 0" class="space-y-2">
      <div
        v-for="space in marketplace.installed.value"
        :key="space.id"
        class="flex items-center gap-4 p-4 rounded-lg border border-[var(--app-border)]"
      >
        <!-- Icon + info -->
        <div class="size-10 rounded-lg bg-[color-mix(in_srgb,var(--app-accent)_10%,transparent)] flex items-center justify-center shrink-0">
          <Icon name="i-lucide-box" class="size-5 text-[var(--app-accent)]" />
        </div>
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-2">
            <span class="text-sm font-medium text-[var(--app-foreground)]">{{ space.display_name }}</span>
            <span class="text-[10px] text-[var(--app-muted)] bg-[color-mix(in_srgb,var(--app-muted)_8%,transparent)] px-1.5 py-0.5 rounded">
              v{{ space.version }}
            </span>
            <span
              v-if="space.has_update"
              class="text-[10px] font-semibold text-amber-400 bg-amber-400/10 px-1.5 py-0.5 rounded"
            >
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
          <button
            v-if="space.has_update"
            class="p-2 rounded-md text-amber-400 hover:bg-amber-400/10 transition-colors"
            title="Update"
            @click="handleUpdate(space.id)"
          >
            <Download class="size-4" />
          </button>

          <!-- Enable/disable toggle -->
          <button
            class="p-2 rounded-md transition-colors"
            :class="space.enabled
              ? 'text-[var(--app-accent)] hover:bg-[color-mix(in_srgb,var(--app-accent)_8%,transparent)]'
              : 'text-[var(--app-muted)] hover:bg-[color-mix(in_srgb,var(--app-muted)_8%,transparent)]'"
            :title="space.enabled ? 'Disable' : 'Enable'"
            @click="handleToggle(space.id, space.enabled)"
          >
            <component :is="space.enabled ? ToggleRight : ToggleLeft" class="size-5" />
          </button>

          <!-- Uninstall -->
          <button
            v-if="confirmUninstall !== space.id"
            class="p-2 rounded-md text-[var(--app-muted)] hover:text-red-400 hover:bg-red-400/10 transition-colors"
            title="Uninstall"
            @click="confirmUninstall = space.id"
          >
            <Trash2 class="size-4" />
          </button>
          <div v-else class="flex items-center gap-1">
            <button
              class="px-2 py-1 rounded text-xs font-medium text-red-400 bg-red-400/10 hover:bg-red-400/20 transition-colors"
              @click="handleUninstall(space.id)"
            >
              Confirm
            </button>
            <button
              class="px-2 py-1 rounded text-xs text-[var(--app-muted)] hover:bg-[color-mix(in_srgb,var(--app-muted)_8%,transparent)] transition-colors"
              @click="confirmUninstall = null"
            >
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
        @click="router.push('/app/marketplace')"
      >
        Browse Marketplace
      </button>
    </div>
</div>
</template>
