<script setup lang="ts">
import Button from '@/components/ui/Button.vue'
import SnapshotTreeNode from './SnapshotTreeNode.vue'
import { useOperator } from '@/operator'
import { getActiveSpace, setActiveSpace, listAutomationProviders } from '@/lib/spaceContextBus'
import { IS_DEV_INSTANCE } from '@/lib/appPaths'
import { Globe, RefreshCw, Camera, Eye, Trash2, Crosshair } from 'lucide-vue-next'

const toast = useToast()
const operator = useOperator()

interface TabInfo {
  id: string
  label: string
  url?: string
  title?: string
}

interface SnapshotNode {
  id: string
  tag: string
  role?: string
  name?: string
  text?: string
  value?: string
  attributes?: Record<string, string>
  children?: string[]
}

interface SnapshotData {
  url?: string
  title?: string
  nodes?: SnapshotNode[]
}

const bridgeStatus = ref<'checking' | 'connected' | 'unreachable' | 'disabled'>('checking')
const tabs = ref<TabInfo[]>([])
const providers = ref<string[]>([])
const activeSpace = ref<string | null>(null)
const isLoadingTabs = ref(false)
const snapshotData = ref<SnapshotData | null>(null)
const snapshotError = ref<string | null>(null)
const snapshotTab = ref<string | null>(null)
const screenshotUrl = ref<string | null>(null)
const screenshotPath = ref<string | null>(null)
const expandedNodes = ref<Set<string>>(new Set())
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

async function loadTabs() {
  isLoadingTabs.value = true
  try {
    const result = await operator.send<{ tabs?: TabInfo[] }>('browser.tabs', {})
    tabs.value = result?.tabs || []
  } catch {
    tabs.value = []
  } finally {
    isLoadingTabs.value = false
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

const targetOptions = computed(() => {
  const opts: { value: string; label: string; type: string }[] = []
  for (const p of providers.value) {
    opts.push({ value: p, label: p, type: 'space' })
  }
  for (const t of tabs.value) {
    if (!opts.some(o => o.value === t.id)) {
      opts.push({ value: t.id, label: t.title || t.id, type: 'tab' })
    }
  }
  return opts
})

async function takeSnapshot(tabId: string) {
  snapshotTab.value = tabId
  snapshotData.value = null
  snapshotError.value = null
  expandedNodes.value.clear()
  try {
    const result = await operator.send<SnapshotData>('browser.snapshot', { tab_id: tabId })
    snapshotData.value = result || null
    // Auto-expand first few top-level nodes
    if (result?.nodes) {
      const topLevel = result.nodes.filter(n => !result.nodes!.some(p => p.children?.includes(n.id)))
      for (const n of topLevel.slice(0, 5)) {
        expandedNodes.value.add(n.id)
      }
    }
  } catch (e) {
    snapshotError.value = `${e}`
  }
}

async function takeScreenshot(tabId: string) {
  screenshotUrl.value = null
  screenshotPath.value = null
  try {
    const result = await operator.send<{ path?: string }>('browser.screenshot', { tab_id: tabId })
    screenshotPath.value = result?.path || null
    if (screenshotPath.value) {
      // Try convertFileSrc (asset protocol), fallback to reading as binary blob
      try {
        const { convertFileSrc } = await import('@tauri-apps/api/core')
        screenshotUrl.value = convertFileSrc(screenshotPath.value)
      } catch {
        try {
          const { readFile } = await import('@tauri-apps/plugin-fs')
          const bytes = await readFile(screenshotPath.value)
          const blob = new Blob([bytes], { type: 'image/png' })
          screenshotUrl.value = URL.createObjectURL(blob)
        } catch {
          screenshotUrl.value = null
        }
      }
      toast.add({ title: 'Screenshot captured', color: 'success' })
    }
  } catch (e) {
    toast.add({ title: `Screenshot failed: ${e}`, color: 'error' })
  }
}

async function closeTab(tabId: string) {
  try {
    await operator.send('browser.close', { tab_id: tabId })
    toast.add({ title: 'Tab closed', color: 'info' })
    await loadTabs()
  } catch (e) {
    toast.add({ title: `Close failed: ${e}`, color: 'error' })
  }
}

function toggleNode(nodeId: string) {
  if (expandedNodes.value.has(nodeId)) {
    expandedNodes.value.delete(nodeId)
  } else {
    expandedNodes.value.add(nodeId)
  }
}

function getNodeById(id: string): SnapshotNode | undefined {
  return snapshotData.value?.nodes?.find(n => n.id === id)
}

function nodeLabel(node: SnapshotNode): string {
  const parts: string[] = [`<${node.tag}>`]
  if (node.role) parts.push(`[${node.role}]`)
  if (node.name) parts.push(`name="${node.name}"`)
  if (node.text) parts.push(`"${node.text.length > 60 ? node.text.slice(0, 60) + '...' : node.text}"`)
  if (node.value) parts.push(`value="${node.value.length > 40 ? node.value.slice(0, 40) + '...' : node.value}"`)
  return parts.join(' ')
}

function topLevelNodes(): SnapshotNode[] {
  if (!snapshotData.value?.nodes) return []
  const childSet = new Set<string>()
  for (const n of snapshotData.value.nodes) {
    if (n.children) n.children.forEach(c => childSet.add(c))
  }
  return snapshotData.value.nodes.filter(n => !childSet.has(n.id))
}

const bridgeStatusColor: Record<string, string> = {
  connected: 'bg-green-500/10 text-green-500',
  unreachable: 'bg-red-500/10 text-red-500',
  disabled: 'bg-amber-500/10 text-amber-500',
  checking: 'bg-gray-500/10 text-gray-500',
}

onMounted(() => {
  checkBridge()
  loadTabs()
  refreshState()
})
</script>

<template>
  <div class="space-y-8">
    <div>
      <h2 class="text-lg font-semibold text-app mb-1">Browser Automation</h2>
      <p class="text-sm text-app-muted">Built-in browser and space automation for the operator</p>
    </div>

    <!-- Info -->
    <div class="p-3 rounded-lg bg-blue-500/5 border border-blue-500/20">
      <div class="flex gap-2">
        <svg class="w-4 h-4 text-blue-500 shrink-0 mt-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10" /><line x1="12" y1="16" x2="12" y2="12" /><line x1="12" y1="8" x2="12.01" y2="8" /></svg>
        <p class="text-xs text-[var(--app-muted)]">The operator can automate Construct spaces via semantic actions and control browser tabs via DOM commands. No external servers or extensions required.</p>
      </div>
    </div>

    <!-- Bridge Status + Target Selection -->
    <div class="space-y-4">
      <div class="flex items-center justify-between py-3 border-b border-app">
        <div>
          <p class="text-sm font-medium text-app">Desktop Bridge</p>
          <p class="text-xs text-app-muted">Connection between operator and Tauri (port {{ bridgePortLabel }})</p>
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

      <!-- Automation Target Selection -->
      <div class="py-3 border-b border-app">
        <div class="flex items-center justify-between mb-2">
          <div>
            <p class="text-sm font-medium text-app">Automation Target</p>
            <p class="text-xs text-app-muted">Select the space or tab to target for automation commands</p>
          </div>
        </div>
        <div class="flex items-center gap-2 mt-2">
          <select
            v-model="selectedTarget"
            class="flex-1 text-sm bg-[var(--app-surface)] text-app border border-[var(--app-border)] rounded-md px-2.5 py-1.5 outline-none focus:border-[var(--app-accent)]"
          >
            <option :value="null">None (auto-detect from router)</option>
            <optgroup v-if="targetOptions.some(o => o.type === 'space')" label="Spaces">
              <option
                v-for="opt in targetOptions.filter(o => o.type === 'space')"
                :key="opt.value"
                :value="opt.value"
              >
                {{ opt.label }}
              </option>
            </optgroup>
            <optgroup v-if="targetOptions.some(o => o.type === 'tab')" label="Browser Tabs">
              <option
                v-for="opt in targetOptions.filter(o => o.type === 'tab')"
                :key="opt.value"
                :value="opt.value"
              >
                {{ opt.label }}
              </option>
            </optgroup>
          </select>
          <Button variant="soft" size="xs" @click="applyTarget">
            <Crosshair class="size-3 mr-1" />
            Set Target
          </Button>
        </div>
        <p v-if="activeSpace" class="text-[11px] text-app-muted mt-1.5">
          Current target: <span class="font-mono text-app-accent">{{ activeSpace }}</span>
        </p>
      </div>

      <!-- Automation Providers -->
      <div class="py-3 border-b border-app">
        <div class="flex items-center justify-between mb-2">
          <div>
            <p class="text-sm font-medium text-app">Space Providers</p>
            <p class="text-xs text-app-muted">Spaces that registered semantic automation actions</p>
          </div>
          <Button variant="ghost" size="xs" @click="refreshState">
            <RefreshCw class="size-3" />
          </Button>
        </div>
        <div v-if="providers.length" class="flex flex-wrap gap-1.5 mt-2">
          <span
            v-for="p in providers"
            :key="p"
            class="px-2 py-0.5 text-[11px] rounded-full bg-[color-mix(in_srgb,var(--app-accent)_10%,transparent)] text-app-accent"
          >
            {{ p }}
          </span>
        </div>
        <p v-else class="text-xs text-app-muted mt-1">No providers registered. Navigate to a space to activate its provider.</p>
      </div>
    </div>

    <!-- Browser Tabs -->
    <div>
      <div class="flex items-center justify-between mb-3">
        <h3 class="text-sm font-semibold text-app">Browser Tabs</h3>
        <Button variant="soft" size="xs" :loading="isLoadingTabs" @click="loadTabs">
          <RefreshCw class="size-3 mr-1" />
          Refresh
        </Button>
      </div>

      <div v-if="tabs.length === 0 && !isLoadingTabs" class="text-center py-8 text-app-muted">
        <Globe class="size-8 mx-auto mb-2 opacity-40" />
        <p class="text-sm">No browser tabs open</p>
        <p class="text-xs mt-1">Tabs opened via the operator or browser space will appear here</p>
      </div>

      <div v-else class="space-y-2">
        <div
          v-for="tab in tabs"
          :key="tab.id"
          class="p-3 rounded-lg border border-[var(--app-border)] space-y-2"
        >
          <div class="flex items-start justify-between">
            <div class="min-w-0 flex-1">
              <p class="text-sm font-medium text-app truncate">{{ tab.title || 'Untitled' }}</p>
              <p class="text-xs text-app-muted truncate">{{ tab.url || tab.id }}</p>
            </div>
            <span class="text-[10px] text-app-muted font-mono shrink-0 ml-2">{{ tab.id }}</span>
          </div>
          <div class="flex gap-1.5">
            <Button variant="ghost" size="xs" @click="takeSnapshot(tab.id)">
              <Eye class="size-3 mr-1" />
              Snapshot
            </Button>
            <Button variant="ghost" size="xs" @click="takeScreenshot(tab.id)">
              <Camera class="size-3 mr-1" />
              Screenshot
            </Button>
            <Button variant="ghost" color="error" size="xs" @click="closeTab(tab.id)">
              <Trash2 class="size-3 mr-1" />
              Close
            </Button>
          </div>

          <!-- Snapshot tree view -->
          <div v-if="snapshotTab === tab.id && (snapshotData || snapshotError)" class="mt-2">
            <!-- Error -->
            <div v-if="snapshotError" class="p-2 rounded bg-red-500/5 border border-red-500/20">
              <p class="text-[11px] text-red-400 font-mono">{{ snapshotError }}</p>
            </div>
            <!-- Tree -->
            <div v-else-if="snapshotData" class="p-2 rounded bg-[color-mix(in_srgb,var(--app-muted)_5%,transparent)] overflow-auto max-h-80">
              <div v-if="snapshotData.title || snapshotData.url" class="mb-2 pb-2 border-b border-[var(--app-border)]">
                <p v-if="snapshotData.title" class="text-[11px] font-medium text-app">{{ snapshotData.title }}</p>
                <p v-if="snapshotData.url" class="text-[10px] text-app-muted truncate">{{ snapshotData.url }}</p>
                <p class="text-[10px] text-app-muted mt-0.5">{{ snapshotData.nodes?.length || 0 }} nodes</p>
              </div>
              <!-- Recursive tree rendering via flat iteration -->
              <template v-for="rootNode in topLevelNodes()" :key="rootNode.id">
                <SnapshotTreeNode
                  :node="rootNode"
                  :depth="0"
                  :expanded-nodes="expandedNodes"
                  :get-node-by-id="getNodeById"
                  :node-label="nodeLabel"
                  :toggle-node="toggleNode"
                />
              </template>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Screenshot preview -->
    <div v-if="screenshotPath">
      <h3 class="text-sm font-semibold text-app mb-2">Last Screenshot</h3>
      <p class="text-xs text-app-muted font-mono mb-2">{{ screenshotPath }}</p>
      <div v-if="screenshotUrl" class="rounded-lg border border-[var(--app-border)] overflow-hidden">
        <img
          :src="screenshotUrl"
          alt="Screenshot"
          class="w-full h-auto max-h-[500px] object-contain bg-[var(--app-surface)]"
        />
      </div>
    </div>
  </div>
</template>
