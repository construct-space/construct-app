<script setup lang="ts">
/**
 * BrowserSettings — Operator automation bridge settings
 *
 * The operator automates spaces via semantic actions (high-level)
 * and browser tabs via DOM commands (low-level fallback).
 * This page shows bridge status, target selection, and active providers.
 */
import { Button } from '@construct-space/ui'
import { useOperator } from '@/operator'
import { getActiveSpace, setActiveSpace, listAutomationProviders } from '@/lib/spaceContextBus'
import { IS_DEV_INSTANCE } from '@/lib/appPaths'
import { RefreshCw, Crosshair } from 'lucide-vue-next'

const toast = useNotification()
const operator = useOperator()

const bridgeStatus = ref<'checking' | 'connected' | 'unreachable' | 'disabled'>('checking')
const providers = ref<string[]>([])
const activeSpace = ref<string | null>(null)
const selectedTarget = ref<string | null>(null)
const bridgePortLabel = computed(() => IS_DEV_INSTANCE.value ? 60201 : 60101)

async function checkBridge() {
  bridgeStatus.value = 'checking'
  if (!operator.isTauri.value) {
    bridgeStatus.value = 'disabled'
    return
  }
  try {
    const info = await operator.send<{ bridgeStatus?: string }>('system.info', {})
    bridgeStatus.value = (info?.bridgeStatus as 'connected' | 'unreachable' | 'disabled') || 'disabled'
  } catch {
    bridgeStatus.value = 'unreachable'
  }
}

function refreshState() {
  activeSpace.value = getActiveSpace()
  providers.value = listAutomationProviders()
  selectedTarget.value = activeSpace.value
}

function applyTarget() {
  if (selectedTarget.value) {
    setActiveSpace(selectedTarget.value)
    activeSpace.value = selectedTarget.value
    toast.add({ title: `Automation target set to "${selectedTarget.value}"`, color: 'success' })
  } else {
    setActiveSpace(null)
    activeSpace.value = null
    toast.add({ title: 'Automation target cleared', color: 'info' })
  }
}

const bridgeStatusColor: Record<string, string> = {
  connected: 'bg-green-500/10 text-green-500',
  unreachable: 'bg-red-500/10 text-red-500',
  disabled: 'bg-amber-500/10 text-amber-500',
  checking: 'bg-gray-500/10 text-gray-500',
}

onMounted(() => {
  checkBridge()
  refreshState()
})
</script>

<template>
  <div class="space-y-6">
    <!-- Info -->
    <div class="p-3 rounded-lg bg-blue-500/5 border border-blue-500/20">
      <div class="flex gap-2">
        <svg class="w-4 h-4 text-blue-500 shrink-0 mt-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          stroke-width="2">
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="16" x2="12" y2="12" />
          <line x1="12" y1="8" x2="12.01" y2="8" />
        </svg>
        <p class="text-xs text-[var(--app-muted)]">
The operator automates spaces via semantic actions and can control
          browser tabs via DOM commands. No external servers or extensions required.
</p>
      </div>
    </div>

    <!-- Bridge Status -->
    <div class="flex items-center justify-between py-3 border-b border-app">
      <div>
        <p class="text-sm font-medium text-app">Desktop Bridge</p>
        <p class="text-xs text-app-muted">Operator ↔ Tauri connection (port {{ bridgePortLabel }})</p>
      </div>
      <div class="flex items-center gap-2">
        <span :class="['px-2 py-0.5 text-[11px] rounded-full', bridgeStatusColor[bridgeStatus]]">
          {{ bridgeStatus }}
        </span>
        <Button variant="ghost" size="xs" @click="checkBridge">
          <RefreshCw class="size-3" />
        </Button>
      </div>
    </div>

    <!-- Automation Target -->
    <div class="py-3 border-b border-app">
      <div class="flex items-center justify-between mb-2">
        <div>
          <p class="text-sm font-medium text-app">Automation Target</p>
          <p class="text-xs text-app-muted">Override which space the operator targets for automation</p>
        </div>
      </div>
      <div class="flex items-center gap-2 mt-2">
        <select v-model="selectedTarget"
          class="flex-1 text-sm bg-[var(--app-surface)] text-app border border-[var(--app-border)] rounded-md px-2.5 py-1.5 outline-none focus:border-[var(--app-accent)]">
          <option :value="null">Auto-detect from active space</option>
          <option v-for="p in providers" :key="p" :value="p">
            {{ p }}
          </option>
        </select>
        <Button variant="soft" size="xs" @click="applyTarget">
          <Crosshair class="size-3 mr-1" />
          Set
        </Button>
      </div>
      <p v-if="activeSpace" class="text-[11px] text-app-muted mt-1.5">
        Current: <span class="font-mono text-app-accent">{{ activeSpace }}</span>
      </p>
    </div>

    <!-- Space Providers -->
    <div>
      <div class="flex items-center justify-between mb-3">
        <div>
          <p class="text-sm font-medium text-app">Space Providers</p>
          <p class="text-xs text-app-muted">Spaces with registered automation actions</p>
        </div>
        <Button variant="ghost" size="xs" @click="refreshState">
          <RefreshCw class="size-3" />
        </Button>
      </div>
      <div v-if="providers.length" class="flex flex-wrap gap-1.5">
        <span v-for="p in providers" :key="p"
          class="px-2.5 py-1 text-xs rounded-full bg-[color-mix(in_srgb,var(--app-accent)_10%,transparent)] text-app-accent">
          {{ p }}
        </span>
      </div>
      <p v-else class="text-xs text-app-muted">
No providers registered. Navigate to a space to activate its provider.
      </p>
    </div>
  </div>
</template>
