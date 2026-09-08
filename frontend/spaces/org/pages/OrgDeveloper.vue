<script setup lang="ts">
/**
 * OrgDeveloper — org-side developer enrollment.
 *
 * Mirror of the personal Developer settings, scoped to the organization.
 * Visible only when the active scope is org and the caller holds a role
 * that can speak for the org (owner/admin/developer). All actions go to
 * /api/developer/enroll/org and /api/developer/transfers/* — same wire
 * surface the personal page uses, just keyed on org identity.
 */
import { Badge, Button, Card, ConfirmationModal } from '@construct-space/ui'
import { useAuthStore } from '@/stores/auth'
import { appConfig } from '@/utils/config'
import { writePublisherToAuthJson } from '@/composables/useDevMode'

const toast = useNotification()
const authStore = useAuthStore()

const enrolling = ref(false)
const unenrolling = ref(false)
const unenrollConfirmOpen = ref(false)

const canManage = computed(() => {
  if (authStore.scope !== 'org') return false
  const roles = (authStore.roles || []).map(role => role.trim().toLowerCase())
  return roles.includes('owner') || roles.includes('admin') || roles.includes('developer')
})
const isOrgOwner = computed(() =>
  authStore.scope === 'org' && (authStore.roles || []).some(role => role.trim().toLowerCase() === 'owner')
)

interface OrgPublisher {
  name: string
  kind: string
  api_key?: string
  apiKey?: string
  orgId?: string
  org_id?: string
}
const orgPublisher = ref<OrgPublisher | null>(null)
const orgPublisherRevealed = ref(false)
const orgPublisherLoading = ref(false)

interface OrgSpace {
  name: string
  displayName: string
  status: string
}
const orgSpaces = ref<OrgSpace[]>([])
const orgSpacesLoaded = ref(false)

interface IncomingTransfer {
  id: number
  spaceName: string
  spaceDisplayName: string
  fromUserId?: string
  message?: string
  expiresAt?: string
}
const incoming = ref<IncomingTransfer[]>([])
const incomingLoaded = ref(false)
const respondingId = ref<number | null>(null)

function authHeader(): Record<string, string> {
  const token = authStore.oauthToken || authStore.token
  return token ? { Authorization: `Bearer ${token}` } : {}
}

function devApi(path: string): string {
  return `${appConfig.accountsUrl.replace(/\/+$/, '')}/api/developer${path}`
}

// Load org publisher (if any) by asking the same cli-verify endpoint the
// app uses for personal — it returns every publisher the user has access
// to. Filter to org-kind matching the active org.
async function loadOrgPublisher() {
  orgPublisherLoading.value = true
  try {
    const directResp = await fetch(devApi('/publisher/org'), { headers: authHeader() })
    if (directResp.ok) {
      const directData = await directResp.json() as { publisher?: OrgPublisher | null }
      if (directData.publisher) {
        const p = directData.publisher
        orgPublisher.value = {
          ...p,
          orgId: p.orgId || p.org_id || authStore.orgId || undefined,
          api_key: p.api_key || p.apiKey,
        }
        return
      }
    }

    const resp = await fetch(devApi('/auth/cli-verify'), { headers: authHeader() })
    if (!resp.ok) { orgPublisher.value = null; return }
    const data = await resp.json() as { publishers?: OrgPublisher[] }
    const match = (data.publishers || []).find(
      p => p.kind === 'org' && (p.orgId || p.org_id) === authStore.orgId,
    )
    orgPublisher.value = match
      ? { ...match, orgId: match.orgId || match.org_id, api_key: match.api_key || match.apiKey }
      : null
  } catch {
    orgPublisher.value = null
  } finally {
    orgPublisherLoading.value = false
  }
}

async function loadOrgSpaces() {
  if (!authStore.orgId) {
    orgSpaces.value = []
    orgSpacesLoaded.value = true
    return
  }
  try {
    const resp = await fetch(devApi('/spaces/mine'), { headers: authHeader() })
    if (!resp.ok) { orgSpaces.value = []; return }
    const data = await resp.json() as {
      spaces?: Array<{ name: string; displayName?: string; status?: string; ownerOrgId?: string }>
    }
    orgSpaces.value = (data.spaces || [])
      .filter(s => s.ownerOrgId === authStore.orgId)
      .map(s => ({
        name: s.name,
        displayName: s.displayName || s.name,
        status: s.status || 'unknown',
      }))
  } catch {
    orgSpaces.value = []
  } finally {
    orgSpacesLoaded.value = true
  }
}

async function loadIncoming() {
  if (!isOrgOwner.value) {
    incoming.value = []
    incomingLoaded.value = true
    return
  }
  try {
    const resp = await fetch(devApi('/transfers/incoming'), { headers: authHeader() })
    if (!resp.ok) { incoming.value = []; return }
    const data = await resp.json() as {
      transfers?: Array<{ id: number; spaceName?: string; spaceDisplayName?: string; fromUserId?: string; message?: string; expiresAt?: string; toOrgId?: string }>
    }
    // Backend returns transfers targeting the caller or, for owners, their
    // org. Filter to the current org so personal acceptances never mix in.
    incoming.value = (data.transfers || [])
      .filter(t => t.toOrgId === authStore.orgId)
      .map(t => ({
        id: t.id,
        spaceName: t.spaceName || `space-${t.id}`,
        spaceDisplayName: t.spaceDisplayName || t.spaceName || `Space ${t.id}`,
        fromUserId: t.fromUserId,
        message: t.message,
        expiresAt: t.expiresAt,
      }))
  } catch {
    incoming.value = []
  } finally {
    incomingLoaded.value = true
  }
}

async function refreshAll() {
  await Promise.all([loadOrgPublisher(), loadOrgSpaces(), loadIncoming()])
}

onMounted(refreshAll)

async function handleEnroll() {
  enrolling.value = true
  try {
    const resp = await fetch(devApi('/enroll/org'), {
      method: 'POST',
      headers: authHeader(),
    })
    const data = await resp.json().catch(() => ({})) as {
      publisher?: OrgPublisher
      apiKey?: string
      api_key?: string
      error?: string
    }
    if (resp.ok && data.publisher) {
      const apiKey = data.apiKey || data.api_key || data.publisher.api_key || data.publisher.apiKey
      orgPublisher.value = {
        ...data.publisher,
        orgId: data.publisher.orgId || data.publisher.org_id || authStore.orgId || undefined,
        api_key: apiKey,
      }
      // Persist the org's publisher key to auth.json so CLI + operator graph
      // tools + space runtime can publish-as-org without a separate fetch.
      // Personal enrollment already does this; matching it keeps both
      // identities first-class on disk.
      if (apiKey) {
        await writePublisherToAuthJson(apiKey, { name: data.publisher.name, kind: 'org' })
      }
      toast.add({ title: 'Organization enrolled', color: 'success' })
      await authStore.refreshScope()
      await Promise.all([loadOrgSpaces(), loadIncoming()])
      if (!apiKey) await loadOrgPublisher()
    } else {
      toast.add({ title: data.error || 'Enrollment failed', color: 'error' })
    }
  } catch {
    toast.add({ title: 'Failed to enroll organization', color: 'error' })
  } finally {
    enrolling.value = false
  }
}

async function handleUnenroll() {
  unenrolling.value = true
  try {
    const resp = await fetch(devApi('/enroll/org'), {
      method: 'DELETE',
      headers: authHeader(),
    })
    const data = await resp.json().catch(() => ({}))
    if (resp.ok) {
      toast.add({ title: 'Organization developer disabled', color: 'success' })
      unenrollConfirmOpen.value = false
      await Promise.all([authStore.refreshScope(), refreshAll()])
    } else {
      toast.add({
        title: data.message || data.error || 'Failed to disable',
        color: 'error',
      })
    }
  } catch {
    toast.add({ title: 'Failed to disable', color: 'error' })
  } finally {
    unenrolling.value = false
  }
}

async function respondToTransfer(id: number, accept: boolean) {
  respondingId.value = id
  try {
    const path = accept ? `/transfers/${id}/accept` : `/transfers/${id}/decline`
    const resp = await fetch(devApi(path), {
      method: 'POST',
      headers: authHeader(),
    })
    const data = await resp.json().catch(() => ({}))
    if (resp.ok) {
      toast.add({
        title: accept ? 'Transfer accepted' : 'Transfer declined',
        color: 'success',
      })
      await Promise.all([loadIncoming(), loadOrgSpaces()])
    } else {
      toast.add({ title: data.error || 'Failed to respond', color: 'error' })
    }
  } catch {
    toast.add({ title: 'Failed to respond to transfer', color: 'error' })
  } finally {
    respondingId.value = null
  }
}

function maskKey(key: string): string {
  if (!key) return ''
  if (key.length <= 12) return key
  return key.slice(0, 8) + '•'.repeat(20) + key.slice(-4)
}

async function copyOrgKey() {
  if (!orgPublisher.value?.api_key) return
  try {
    await navigator.clipboard.writeText(orgPublisher.value.api_key)
    toast.add({ title: 'API key copied', color: 'success' })
  } catch {
    toast.add({ title: 'Failed to copy', color: 'error' })
  }
}
</script>

<template>
  <div class="space-y-4">
    <!-- Permission check: non-eligible members get a stub. The Org nav
         entry hides itself for them, but they could still hit the route
         directly, so render an explanation rather than a 403-from-action. -->
    <Card v-if="!canManage">
      <template #header>
        <h3 class="text-sm tracking-[0.08em] uppercase font-normal text-[var(--app-foreground)] leading-tight after:content-['.'] after:text-[var(--app-accent)]">Developer</h3>
        <p class="text-sm text-[var(--app-muted)] mt-2">
          Organization developer settings are managed by owners, admins, and members with the Developer role.
        </p>
      </template>
    </Card>

    <template v-else>
      <!-- Not enrolled — single-action card to flip on org publishing. -->
      <Card v-if="!authStore.orgDeveloper">
        <template #header>
          <h3 class="text-sm tracking-[0.08em] uppercase font-normal text-[var(--app-foreground)] leading-tight after:content-['.'] after:text-[var(--app-accent)]">Developer access</h3>
          <p class="text-sm text-[var(--app-muted)] mt-2">
            Enroll {{ authStore.orgName || 'this organization' }} as a developer publisher. Spaces published with the org's API key will be owned by the organization, not the publisher.
          </p>
        </template>
        <template #accessory>
          <Button variant="soft" :loading="enrolling" label="Enroll Organization" @click="handleEnroll" />
        </template>
      </Card>

      <!-- Enrolled — status + publisher key + spaces + incoming transfers. -->
      <template v-else>
        <Card>
          <template #header>
            <h3 class="text-sm tracking-[0.08em] uppercase font-normal text-[var(--app-foreground)] leading-tight after:content-['.'] after:text-[var(--app-accent)]">Developer access</h3>
            <p class="text-sm text-[var(--app-muted)] mt-2">
              {{ authStore.orgName || 'This organization' }} is enrolled as a developer publisher. The Developer role has been added to your role catalog and can be assigned to members.
            </p>
          </template>
          <template #accessory>
            <div class="flex items-center gap-2">
              <Badge color="success" size="xs">Enrolled</Badge>
              <Button
                variant="ghost"
                size="xs"
                color="error"
                :disabled="orgSpaces.length > 0"
                :title="orgSpaces.length > 0 ? 'Transfer or delete the org’s spaces first' : ''"
                label="Disable"
                @click="unenrollConfirmOpen = true"
              />
            </div>
          </template>
        </Card>

        <!-- Publisher key — single source of truth for the org's CLI auth. -->
        <Card>
          <template #header>
            <h3 class="text-sm tracking-[0.08em] uppercase font-normal text-[var(--app-foreground)] leading-tight after:content-['.'] after:text-[var(--app-accent)]">Org publisher</h3>
            <p class="text-sm text-[var(--app-muted)] mt-0.5">
              <template v-if="orgPublisher">
                <span class="font-mono">{{ orgPublisher.name }}</span> — share this key with members who publish on behalf of {{ authStore.orgName || 'the org' }}
              </template>
              <template v-else-if="!orgPublisherLoading">
                Key not synced. Try Refresh.
              </template>
            </p>
          </template>
          <template #accessory>
            <Button
              variant="soft"
              size="xs"
              icon="lucide:refresh-cw"
              :loading="orgPublisherLoading"
              label="Refresh"
              @click="loadOrgPublisher"
            />
          </template>
          <div v-if="orgPublisher?.api_key" class="flex items-center gap-2">
            <code class="flex-1 px-3 py-2 rounded-sm text-xs font-mono truncate bg-[var(--app-canvas-bg)] border border-[var(--app-border)] text-[var(--app-foreground)] select-all">
              {{ orgPublisherRevealed ? orgPublisher.api_key : maskKey(orgPublisher.api_key) }}
            </code>
            <Button
              variant="soft"
              size="xs"
              :icon="orgPublisherRevealed ? 'lucide:eye-off' : 'lucide:eye'"
              @click="orgPublisherRevealed = !orgPublisherRevealed"
            />
            <Button variant="soft" size="xs" icon="lucide:copy" @click="copyOrgKey" />
          </div>
        </Card>

        <!-- Org-owned spaces. Listed for situational awareness; transfers
             go elsewhere (currently the personal Developer page or a
             space's own settings). -->
        <Card>
          <template #header>
            <h3 class="text-sm tracking-[0.08em] uppercase font-normal text-[var(--app-foreground)] leading-tight after:content-['.'] after:text-[var(--app-accent)]">Org spaces</h3>
            <p class="text-sm text-[var(--app-muted)] mt-2">
              Spaces owned by {{ authStore.orgName || 'this organization' }}.
            </p>
          </template>
          <div class="space-y-2">
            <p v-if="!orgSpacesLoaded" class="text-xs text-[var(--app-muted)]">Loading…</p>
            <p v-else-if="orgSpaces.length === 0" class="text-xs text-[var(--app-muted)]">
              No org spaces yet. Use the org's API key with the Construct CLI to publish one, or accept an incoming transfer.
            </p>
            <div
              v-else
              v-for="space in orgSpaces"
              :key="space.name"
              class="flex items-center gap-2 px-3 py-2 rounded-sm bg-[var(--app-canvas-bg)] border border-[var(--app-border)]"
            >
              <div class="flex-1 min-w-0">
                <p class="text-sm text-[var(--app-foreground)] truncate">{{ space.displayName }}</p>
                <p class="text-xs text-[var(--app-muted)] font-mono">{{ space.name }} · {{ space.status }}</p>
              </div>
            </div>
          </div>
        </Card>

        <!-- Incoming transfers. Only the org owner can accept/decline
             ownership handoffs into the org. -->
        <Card>
          <template #header>
            <h3 class="text-sm tracking-[0.08em] uppercase font-normal text-[var(--app-foreground)] leading-tight after:content-['.'] after:text-[var(--app-accent)]">Pending transfers</h3>
            <p class="text-sm text-[var(--app-muted)] mt-2">
              Spaces being offered to {{ authStore.orgName || 'this organization' }}. Accept to take ownership; decline to leave them where they are.
            </p>
          </template>
          <div class="space-y-2">
            <p v-if="!isOrgOwner" class="text-xs text-[var(--app-muted)]">
              Only the org owner can accept or decline space transfers.
            </p>
            <p v-else-if="!incomingLoaded" class="text-xs text-[var(--app-muted)]">Loading…</p>
            <p v-else-if="incoming.length === 0" class="text-xs text-[var(--app-muted)]">
              No pending transfers.
            </p>
            <div
              v-for="t in incoming"
              :key="t.id"
              class="flex items-start gap-3 px-3 py-2 rounded-sm bg-[var(--app-canvas-bg)] border border-[var(--app-border)]"
            >
              <div class="flex-1 min-w-0">
                <p class="text-sm text-[var(--app-foreground)] truncate">{{ t.spaceDisplayName }}</p>
                <p class="text-xs text-[var(--app-muted)] font-mono">{{ t.spaceName }}</p>
                <p v-if="t.message" class="text-xs text-[var(--app-muted)] mt-1 italic">"{{ t.message }}"</p>
              </div>
              <div class="flex items-center gap-2 shrink-0">
                <Button
                  variant="ghost"
                  size="xs"
                  :loading="respondingId === t.id"
                  label="Decline"
                  @click="respondToTransfer(t.id, false)"
                />
                <Button
                  variant="soft"
                  size="xs"
                  color="success"
                  :loading="respondingId === t.id"
                  label="Accept"
                  @click="respondToTransfer(t.id, true)"
                />
              </div>
            </div>
          </div>
        </Card>
      </template>
    </template>

    <ConfirmationModal
      v-model="unenrollConfirmOpen"
      title="Disable organization developer?"
      :message="`${authStore.orgName || 'This organization'}'s Publisher row will be removed. Spaces it currently owns won't return automatically — they'd need to be transferred elsewhere first.`"
      :details="`The Developer role will also be removed from the org's role catalog. Members who were assigned the role fall back to Member.`"
      confirm-text="Disable"
      confirm-color="error"
      :loading="unenrolling"
      @confirm="handleUnenroll"
    />
  </div>
</template>
