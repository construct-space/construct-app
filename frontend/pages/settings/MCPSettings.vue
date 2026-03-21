<script setup lang="ts">
import { useOperator } from '@/operator'
import Input from '@/components/ui/Input.vue'
import Select from '@/components/ui/Select.vue'
import Switch from '@/components/ui/Switch.vue'
import Button from '@/components/ui/Button.vue'

const toast = useToast()
const operator = useOperator()

interface MCPTool {
  name: string
  description: string
}

interface MCPServer {
  id: string
  name: string
  type: 'npm' | 'local' | 'builtin' | 'url'
  package?: string
  path?: string
  url?: string
  transport?: string
  enabled: boolean
  status: 'running' | 'stopped' | 'error'
  tools: MCPTool[]
  error?: string
}

const servers = ref<MCPServer[]>([])
const isLoading = ref(false)
const showAddForm = ref(false)
const isAdding = ref(false)
const selectedServer = ref<MCPServer | null>(null)

const newServer = ref({
  type: 'url' as 'url' | 'npm' | 'local',
  url: '',
  transport: 'http',
  package: '',
  path: '',
  name: '',
})

const transportOptions = [
  { label: 'HTTP (Streamable)', value: 'http' },
  { label: 'SSE (Server-Sent Events)', value: 'sse' },
  { label: 'Stdio (Local Process)', value: 'stdio' },
]

const statusColors: Record<string, string> = {
  running: 'bg-green-500/10 text-green-500',
  stopped: 'bg-amber-500/10 text-amber-500',
  error: 'bg-red-500/10 text-red-500',
}

async function loadServers() {
  if (!operator.isTauri.value) return
  isLoading.value = true
  try {
    const result = await operator.send('mcp.list', {}) as { servers?: MCPServer[] }
    servers.value = result?.servers || []
  } catch {
    servers.value = []
  } finally {
    isLoading.value = false
  }
}

async function toggleServer(server: MCPServer) {
  try {
    if (server.enabled) {
      await operator.send('mcp.disable', { id: server.id })
      toast.add({ title: `${server.name} disabled`, color: 'warning' })
    } else {
      await operator.send('mcp.enable', { id: server.id })
      toast.add({ title: `${server.name} enabled`, color: 'success' })
    }
    await loadServers()
  } catch (e) {
    toast.add({ title: String(e), color: 'error' })
  }
}

function normalizeUrl(input: string): string {
  let url = input.trim()
  if (!url) return url
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    url = `https://${url}`
  }
  return url
}

async function addServer() {
  const type = newServer.value.type
  if (type === 'url' && !newServer.value.url) { toast.add({ title: 'Please enter a server URL', color: 'error' }); return }
  if (type === 'npm' && !newServer.value.package) { toast.add({ title: 'Please specify a package name', color: 'error' }); return }
  if (type === 'local' && !newServer.value.path) { toast.add({ title: 'Please specify a path', color: 'error' }); return }

  isAdding.value = true
  try {
    const payload: Record<string, string | undefined> = { type, name: newServer.value.name || undefined }
    if (type === 'url') {
      payload.url = normalizeUrl(newServer.value.url)
      payload.transport = newServer.value.transport
      if (!payload.name) {
        try { payload.name = new URL(payload.url).hostname.replace(/^mcp\./, '').split('.')[0] } catch { /* use default */ }
      }
    } else if (type === 'npm') {
      payload.package = newServer.value.package
    } else if (type === 'local') {
      payload.path = newServer.value.path
    }
    await operator.send('mcp.add', payload)
    toast.add({ title: `${payload.name || 'MCP server'} added`, color: 'success' })
    showAddForm.value = false
    newServer.value = { type: 'url', url: '', transport: 'http', package: '', path: '', name: '' }
    await loadServers()
  } catch (e) {
    toast.add({ title: String(e), color: 'error' })
  } finally {
    isAdding.value = false
  }
}

async function removeServer(server: MCPServer) {
  try {
    await operator.send('mcp.remove', { id: server.id })
    toast.add({ title: `${server.name} removed`, color: 'info' })
    if (selectedServer.value?.id === server.id) selectedServer.value = null
    await loadServers()
  } catch (e) {
    toast.add({ title: String(e), color: 'error' })
  }
}

async function testServer(server: MCPServer) {
  try {
    await operator.send('mcp.test', { id: server.id })
    toast.add({ title: `${server.name} is responding`, color: 'success' })
  } catch (e) {
    toast.add({ title: `Connection failed: ${e}`, color: 'error' })
  }
}

onMounted(() => { loadServers() })
</script>

<template>
  <div>
    <div class="flex items-center justify-between mb-1">
      <div class="flex gap-2">
        <Button variant="soft" size="sm" :loading="isLoading" label="Refresh" @click="loadServers" />
        <Button size="sm" label="Add Server" @click="showAddForm = !showAddForm" />
      </div>
    </div>

    <!-- Info -->
    <div class="mb-6 p-3 rounded-lg bg-blue-500/5 border border-blue-500/20">
      <div class="flex gap-2">
        <svg class="w-4 h-4 text-blue-500 shrink-0 mt-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10" /><line x1="12" y1="16" x2="12" y2="12" /><line x1="12" y1="8" x2="12.01" y2="8" /></svg>
        <p class="text-xs text-[var(--app-muted)]">MCP servers extend AI capabilities with additional tools like web search, database access, file operations, and more.</p>
      </div>
    </div>

    <!-- Add Server Form -->
    <div v-if="showAddForm" class="mb-6 p-4 rounded-lg border border-[var(--app-border)] space-y-4">
      <h3 class="text-sm font-semibold text-[var(--app-foreground)]">Add MCP Server</h3>

      <!-- Type selection -->
      <div class="flex gap-2">
        <button
          v-for="t in (['url', 'npm', 'local'] as const)"
          :key="t"
          class="px-3 py-1.5 text-xs rounded-md border transition-colors cursor-pointer capitalize"
          :class="newServer.type === t ? 'border-[var(--app-accent)] bg-[color-mix(in_srgb,var(--app-accent)_10%,transparent)] text-app-accent' : 'border-[var(--app-border)] text-[var(--app-muted)]'"
          @click="newServer.type = t"
        >
          {{ t === 'npm' ? 'NPM Package' : t === 'url' ? 'URL' : 'Local Path' }}
        </button>
      </div>

      <!-- URL fields -->
      <template v-if="newServer.type === 'url'">
        <Input v-model="newServer.url" placeholder="mcp.example.com" />
        <p class="text-xs text-[var(--app-muted)] -mt-3">https:// is added automatically</p>
        <Select v-model="newServer.transport" :options="transportOptions" />
      </template>

      <!-- NPM field -->
      <Input v-if="newServer.type === 'npm'" v-model="newServer.package" placeholder="@anthropic/mcp-server-filesystem" />

      <!-- Local path field -->
      <Input v-if="newServer.type === 'local'" v-model="newServer.path" placeholder="/path/to/mcp-server" />

      <!-- Display name -->
      <Input v-model="newServer.name" placeholder="Display Name (optional)" />

      <div class="flex justify-end gap-2">
        <Button variant="ghost" label="Cancel" @click="showAddForm = false" />
        <Button :loading="isAdding" label="Add Server" @click="addServer" />
      </div>
    </div>

    <!-- Loading -->
    <div v-if="isLoading" class="flex items-center justify-center py-12">
      <svg class="w-6 h-6 animate-spin text-[var(--app-muted)]" viewBox="0 0 24 24" fill="none">
        <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
        <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
      </svg>
    </div>

    <!-- Empty state -->
    <div v-else-if="servers.length === 0 && !showAddForm" class="text-center py-12 text-[var(--app-muted)]">
      <p class="text-sm mb-3">No MCP servers configured</p>
      <Button label="Add MCP Server" @click="showAddForm = true" />
    </div>

    <!-- Server list -->
    <div v-else class="space-y-3">
      <div
        v-for="server in servers"
        :key="server.id"
        class="p-4 rounded-lg border transition-colors"
        :class="server.enabled ? 'border-[var(--app-border)]' : 'border-[var(--app-border)] opacity-60'"
      >
        <div class="flex items-start justify-between mb-2">
          <div>
            <div class="flex items-center gap-2">
              <h4 class="text-sm font-medium text-[var(--app-foreground)]">{{ server.name }}</h4>
              <span :class="['px-1.5 py-0.5 text-[10px] rounded-full', statusColors[server.status] || 'bg-gray-500/10 text-gray-500']">
                {{ server.status }}
              </span>
              <span class="px-1.5 py-0.5 text-[10px] rounded-full bg-[color-mix(in_srgb,var(--app-muted)_15%,transparent)] text-[var(--app-muted)]">
                {{ server.type }}
              </span>
            </div>
            <p class="text-xs text-[var(--app-muted)] mt-0.5">
              {{ server.type === 'url' ? server.url : server.type === 'npm' ? server.package : server.path || server.id }}
            </p>
            <p class="text-xs text-[var(--app-muted)] mt-1">{{ server.tools.length }} tool{{ server.tools.length !== 1 ? 's' : '' }}</p>
          </div>
          <Switch :model-value="server.enabled" size="sm" @update:model-value="toggleServer(server)" />
        </div>

        <p v-if="server.error" class="text-xs text-red-500 mt-2">{{ server.error }}</p>

        <!-- Actions -->
        <div class="flex gap-2 mt-3">
          <Button variant="ghost" size="xs" label="Test" @click="testServer(server)" />
          <Button variant="ghost" size="xs" label="Details" @click="selectedServer = selectedServer?.id === server.id ? null : server" />
          <Button v-if="server.type !== 'builtin'" variant="ghost" color="error" size="xs" label="Remove" @click="removeServer(server)" />
        </div>

        <!-- Details panel -->
        <div v-if="selectedServer?.id === server.id" class="mt-3 pt-3 border-t border-[var(--app-border)]">
          <div v-if="server.tools.length" class="space-y-1.5 max-h-40 overflow-y-auto">
            <p class="text-xs text-[var(--app-muted)] uppercase tracking-wider mb-2">Available Tools</p>
            <div v-for="tool in server.tools" :key="tool.name" class="p-2 rounded bg-[color-mix(in_srgb,var(--app-muted)_5%,transparent)]">
              <p class="text-xs font-medium text-[var(--app-foreground)]">{{ tool.name }}</p>
              <p class="text-xs text-[var(--app-muted)]">{{ tool.description }}</p>
            </div>
          </div>
          <p v-else class="text-xs text-[var(--app-muted)]">No tools available</p>
        </div>
      </div>
    </div>
  </div>
</template>
