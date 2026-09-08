<script setup lang="ts">
/**
 * Org-level provider keys — admin-only section of OrganizationSettings.
 *
 * Admins paste one API key per provider; members inherit it automatically
 * (operator bootstrap picks up org keys on boot). Each key has an
 * `enforced` toggle: when on, the org key overrides any personal key the
 * member has set — used to guarantee all usage bills to the org account.
 *
 * The provider list comes from the remote catalog (useProviderCatalog),
 * so new providers surface here without an app release.
 */

import { ref, computed, onMounted } from 'vue'
import { Button } from '@construct-space/ui'
import { Key, ShieldCheck, Loader2, Save, X } from 'lucide-vue-next'
import { useSource } from '@/composables/useSource'
import { useProviderCatalog } from '@/composables/useProviderCatalog'

interface OrgKeyRow {
  provider: string
  masked_key: string
  enforced: boolean
  set_by: string
}

const api = useSource()
const catalog = useProviderCatalog()

const rows = ref<OrgKeyRow[]>([])
const loading = ref(false)
const drafts = ref<Record<string, string>>({})  // providerId → pending new value
const editing = ref<Record<string, boolean>>({})
const saving = ref<Record<string, boolean>>({})
const error = ref('')

const indexed = computed(() => {
  const map = new Map<string, OrgKeyRow>()
  for (const r of rows.value) map.set(r.provider, r)
  return map
})

// Only show providers that take an API key — OAuth providers (Claude,
// Copilot device flow, etc.) can't be centralised as an org key today.
const keyProviders = computed(() =>
  catalog.catalog.value.filter(p => p.authType === 'api' || !p.authType),
)

async function load() {
  loading.value = true
  error.value = ''
  try {
    await catalog.load()
    rows.value = await api.get<OrgKeyRow[]>('/org/providers')
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    loading.value = false
  }
}

function startEdit(providerId: string) {
  editing.value[providerId] = true
  drafts.value[providerId] = ''
}

function cancelEdit(providerId: string) {
  editing.value[providerId] = false
  drafts.value[providerId] = ''
}

async function saveKey(providerId: string) {
  const value = (drafts.value[providerId] || '').trim()
  if (!value) return
  saving.value[providerId] = true
  error.value = ''
  try {
    await api.put(`/org/providers/${providerId}`, { api_key: value })
    await load()
    editing.value[providerId] = false
    drafts.value[providerId] = ''
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    saving.value[providerId] = false
  }
}

async function toggleEnforced(providerId: string, current: boolean) {
  saving.value[providerId] = true
  error.value = ''
  try {
    await api.put(`/org/providers/${providerId}`, { enforced: !current })
    await load()
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    saving.value[providerId] = false
  }
}

async function removeKey(providerId: string) {
  saving.value[providerId] = true
  error.value = ''
  try {
    await api.delete(`/org/providers/${providerId}`)
    await load()
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    saving.value[providerId] = false
  }
}

onMounted(load)
</script>

<template>
  <div class="mt-8">
    <div class="flex items-center justify-between mb-3">
      <div>
        <h3 class="text-sm font-semibold text-app flex items-center gap-2">
          <Key class="size-4" />
          Shared AI provider keys
        </h3>
        <p class="text-xs text-app-muted mt-0.5">
          Paste a key once — every member's operator picks it up on next
          boot. Toggle <strong>Enforce</strong> to override members'
          personal keys and funnel all usage through the org account.
        </p>
      </div>
      <Button
        v-if="!loading"
        variant="soft"
        size="xs"
        label="Refresh"
        @click="load"
      />
    </div>

    <div v-if="loading" class="flex items-center gap-2 text-xs text-app-muted py-4">
      <Loader2 class="size-4 animate-spin" />
      Loading keys…
    </div>

    <p v-if="error" class="text-xs text-red-400 mb-2">{{ error }}</p>

    <div v-if="!loading" class="rounded-lg border border-app divide-y divide-app overflow-hidden">
      <div
        v-for="p in keyProviders"
        :key="p.id"
        class="flex items-center gap-3 px-3 py-3 bg-[var(--app-surface)]"
      >
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-2">
            <p class="text-sm font-medium text-app truncate">{{ p.label }}</p>
            <span
              v-if="indexed.get(p.id)?.enforced"
              class="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-[var(--app-accent)]/15 text-[var(--app-accent)] font-medium"
            >
              <ShieldCheck class="size-3" />
              Enforced
            </span>
          </div>
          <p v-if="indexed.get(p.id)" class="text-xs text-app-muted font-mono truncate">
            {{ indexed.get(p.id)?.masked_key }}
          </p>
          <p v-else class="text-xs text-app-muted">Not set — members fall back to personal keys.</p>
        </div>

        <!-- Edit mode: input + save/cancel -->
        <template v-if="editing[p.id]">
          <input
            v-model="drafts[p.id]"
            type="password"
            :placeholder="`${p.label} API key`"
            class="w-56 px-2 py-1.5 rounded-md border border-app bg-[var(--app-background)] text-xs font-mono text-app placeholder:text-app-muted focus:outline-none focus:ring-1 focus:ring-[var(--app-accent)]"
            @keydown.enter="saveKey(p.id)"
          />
          <Button
            variant="solid"
            size="xs"
            :loading="saving[p.id]"
            :disabled="!drafts[p.id]?.trim() || saving[p.id]"
            @click="saveKey(p.id)"
          >
            <Save class="size-3.5" />
          </Button>
          <Button variant="soft" size="xs" @click="cancelEdit(p.id)">
            <X class="size-3.5" />
          </Button>
        </template>

        <!-- Set-key or manage buttons -->
        <template v-else>
          <Button
            v-if="indexed.get(p.id)"
            variant="soft"
            size="xs"
            :label="indexed.get(p.id)?.enforced ? 'Unenforce' : 'Enforce'"
            :loading="saving[p.id]"
            @click="toggleEnforced(p.id, !!indexed.get(p.id)?.enforced)"
          />
          <Button
            variant="soft"
            size="xs"
            :label="indexed.get(p.id) ? 'Replace' : 'Set key'"
            @click="startEdit(p.id)"
          />
          <Button
            v-if="indexed.get(p.id)"
            variant="soft"
            size="xs"
            class="text-red-400"
            label="Remove"
            :loading="saving[p.id]"
            @click="removeKey(p.id)"
          />
        </template>
      </div>
      <div v-if="keyProviders.length === 0" class="px-3 py-6 text-center text-xs text-app-muted">
        No providers in the catalog yet.
      </div>
    </div>
  </div>
</template>
