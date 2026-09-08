<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { Mail, Send, RotateCcw, Ban, ChevronLeft, ChevronRight, Copy } from 'lucide-vue-next'
import { Badge, Button, Card, Empty, Input, Select } from '@construct-space/ui'
import { useOrgData } from '@/spaces/org/composables/useOrgData'
import { useOrgPermissions } from '@/spaces/org/composables/useOrgPermissions'
import type { InviteStatus } from '@/types/org'
import ToolbarSlot from '@/components/common/ToolbarSlot.vue'

const {
  invites,
  departments,
  roles: orgRoles,
  sendInvite,
  revokeInvite,
  getDepartmentName,
} = useOrgData()
const { canViewInvites, canManageInvites } = useOrgPermissions()
const toast = useNotification()

const showSendForm = ref(false)
const showHistory = ref(false)

// Track which invite was just copied so we can swap the icon for a brief
// "Copied" affordance — clipboard writes have no visible side-effect on
// their own and a toast alone is easy to miss in a busy table.
const copiedToken = ref<string | null>(null)

async function copyCode(token: string) {
  try {
    await navigator.clipboard.writeText(token)
    copiedToken.value = token
    toast.add({ title: 'Invite code copied', description: token, color: 'success' })
    setTimeout(() => {
      if (copiedToken.value === token) copiedToken.value = null
    }, 1500)
  } catch {
    toast.add({ title: 'Could not copy — paste manually', color: 'error' })
  }
}

const newEmail = ref('')
const newRole = ref('member')
const newDepartmentId = ref('')

const pendingInvites = computed(() =>
  invites.value.filter(i => i.status === 'pending'),
)

const historyInvites = computed(() =>
  invites.value
    .filter(i => i.status !== 'pending')
    // newest first — stable ordering for pagination
    .slice()
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()),
)

// History pagination — keep simple and client-side since invites are
// already in memory. Reset to page 1 when the history list shrinks
// below the current page (e.g. after a revoke/resend).
const historyPage = ref(1)
const HISTORY_PER_PAGE = 10

const historyPageCount = computed(() =>
  Math.max(1, Math.ceil(historyInvites.value.length / HISTORY_PER_PAGE)),
)

const paginatedHistory = computed(() => {
  const start = (historyPage.value - 1) * HISTORY_PER_PAGE
  return historyInvites.value.slice(start, start + HISTORY_PER_PAGE)
})

watch(historyPageCount, (count) => {
  if (historyPage.value > count) historyPage.value = count
})

const roleOptions = computed(() =>
  orgRoles.value
    .filter(r => r.name !== 'Owner')
    .map(r => ({ value: r.name.toLowerCase(), label: r.name })),
)

const departmentOptions = computed(() => [
  { value: '', label: 'No department' },
  ...departments.value.map(d => ({ value: d.id, label: d.name })),
])

function handleSend() {
  const email = newEmail.value.trim()
  if (!email) return
  sendInvite({
    email,
    role: newRole.value,
    department_id: newDepartmentId.value || undefined,
  })
  newEmail.value = ''
  newRole.value = 'member'
  newDepartmentId.value = ''
  showSendForm.value = false
}

function handleRevoke(id: string) {
  revokeInvite(id)
}

function handleResend(invite: { email: string; role: string; department_id: string | null }) {
  sendInvite({
    email: invite.email,
    role: invite.role,
    department_id: invite.department_id ?? undefined,
  })
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

function isExpired(expiresAt: string): boolean {
  return new Date(expiresAt) < new Date()
}

function statusBadgeColor(status: InviteStatus): 'warning' | 'success' | 'neutral' | 'error' {
  switch (status) {
    case 'pending': return 'warning'
    case 'accepted': return 'success'
    case 'expired': return 'neutral'
    case 'revoked': return 'error'
    default: return 'neutral'
  }
}
</script>

<template>
  <!-- No access -->
  <div v-if="!canViewInvites" class="p-6">
    <Card>
      <Empty
        icon="i-lucide-lock"
        title="No access"
        description="You don't have permission to view invitations."
      />
    </Card>
  </div>

  <div v-else class="p-6 space-y-4">
    <ToolbarSlot name="right">
      <Button
        v-if="canManageInvites"
        size="xs"
        :label="showSendForm ? 'Close' : 'Send invite'"
        @click="showSendForm = !showSendForm"
      >
        <template #leading>
          <Send class="size-3.5" />
        </template>
      </Button>
    </ToolbarSlot>
    <!-- Intro -->
    <Card variant="muted">
      <template #header>
        <div class="flex items-start gap-3 min-w-0 flex-1">
          <Mail class="size-5 text-[var(--app-muted)] mt-0.5 shrink-0" />
          <div class="min-w-0 flex-1">
            <h3 class="text-sm tracking-[0.08em] uppercase font-normal text-[var(--app-foreground)] leading-tight after:content-['.'] after:text-[var(--app-accent)]">Invitations <span v-if="pendingInvites.length" class="text-[var(--app-muted)]">({{ pendingInvites.length }})</span></h3>
            <p class="text-sm text-[var(--app-muted)] mt-0.5">Invite people to join this organization. They become members once they accept.</p>
          </div>
        </div>
      </template>
    </Card>

    <!-- Send invite form -->
    <Card v-if="canManageInvites && showSendForm">
      <template #header>
        <div class="min-w-0 flex-1">
          <h4 class="text-sm tracking-[0.08em] uppercase font-normal text-[var(--app-foreground)] leading-tight after:content-['.'] after:text-[var(--app-accent)]">Send invitation</h4>
          <p class="text-xs text-[var(--app-muted)] mt-0.5">Delivers a one-time join link to the email below. The invite expires in 7 days.</p>
        </div>
      </template>

      <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div>
          <label class="block text-[10px] tracking-[0.08em] uppercase text-[var(--app-muted)] mb-1">Email</label>
          <Input
            v-model="newEmail"
            type="email"
            placeholder="name@company.com"
            size="sm"
            @keydown.enter="handleSend"
          />
        </div>
        <div>
          <label class="block text-[10px] tracking-[0.08em] uppercase text-[var(--app-muted)] mb-1">Role</label>
          <Select v-model="newRole" :options="roleOptions" size="sm" />
        </div>
        <div>
          <label class="block text-[10px] tracking-[0.08em] uppercase text-[var(--app-muted)] mb-1">Department</label>
          <Select v-model="newDepartmentId" :options="departmentOptions" size="sm" />
        </div>
      </div>

      <template #footer-end>
        <div class="flex items-center gap-2">
          <Button variant="ghost" size="sm" label="Cancel" @click="showSendForm = false" />
          <Button
            size="sm"
            label="Send invitation"
            :disabled="!newEmail.trim()"
            @click="handleSend"
          >
            <template #leading>
              <Send class="size-3.5" />
            </template>
          </Button>
        </div>
      </template>
    </Card>

    <!-- Pending -->
    <div>
      <h4 class="text-[11px] tracking-[0.12em] uppercase font-medium text-[var(--app-muted)] mb-2">Pending</h4>

      <Card v-if="pendingInvites.length === 0">
        <Empty
          icon="i-lucide-mail-question"
          title="No pending invitations"
          :description="canManageInvites ? 'Send an invite to get someone started.' : 'Nothing waiting on a response right now.'"
        >
          <Button v-if="canManageInvites && !showSendForm" size="sm" label="Send invite" @click="showSendForm = true">
            <template #leading>
              <Send class="size-3.5" />
            </template>
          </Button>
        </Empty>
      </Card>

      <Card v-else>
        <div class="-mx-5 -my-5">
          <table class="w-full">
            <thead>
              <tr class="border-b border-[var(--app-border)]">
                <th class="text-left text-[10px] tracking-[0.08em] uppercase font-medium text-[var(--app-muted)] px-4 py-2.5">Email</th>
                <th class="text-left text-[10px] tracking-[0.08em] uppercase font-medium text-[var(--app-muted)] px-4 py-2.5">Role</th>
                <th class="text-left text-[10px] tracking-[0.08em] uppercase font-medium text-[var(--app-muted)] px-4 py-2.5">Code</th>
                <th class="text-left text-[10px] tracking-[0.08em] uppercase font-medium text-[var(--app-muted)] px-4 py-2.5">Invited</th>
                <th class="text-left text-[10px] tracking-[0.08em] uppercase font-medium text-[var(--app-muted)] px-4 py-2.5">Expires</th>
                <th v-if="canManageInvites" class="text-right text-[10px] tracking-[0.08em] uppercase font-medium text-[var(--app-muted)] px-4 py-2.5">Actions</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-[var(--app-border)]">
              <tr v-for="inv in pendingInvites" :key="inv.id">
                <td class="px-4 py-2.5">
                  <div class="text-sm text-[var(--app-foreground)]">{{ inv.email }}</div>
                  <div v-if="inv.department_id" class="text-xs text-[var(--app-muted)]">
                    {{ getDepartmentName(inv.department_id) }}
                  </div>
                </td>
                <td class="px-4 py-2.5">
                  <Badge color="neutral" size="xs">{{ inv.role }}</Badge>
                </td>
                <td class="px-4 py-2.5">
                  <button
                    type="button"
                    :title="copiedToken === inv.token ? 'Copied' : 'Click to copy'"
                    class="inline-flex items-center gap-1.5 px-2 py-1 rounded-sm border border-[var(--app-border)] bg-[var(--app-background)] hover:border-[var(--app-accent)] hover:text-[var(--app-foreground)] text-[var(--app-muted)] transition-colors cursor-pointer"
                    @click="copyCode(inv.token)"
                  >
                    <span class="font-mono text-xs tracking-wider">{{ inv.token }}</span>
                    <Copy v-if="copiedToken !== inv.token" class="size-3 shrink-0" />
                    <span v-else class="text-[10px] tracking-[0.08em] uppercase text-emerald-500">Copied</span>
                  </button>
                </td>
                <td class="px-4 py-2.5 text-xs text-[var(--app-muted)]">{{ formatDate(inv.created_at) }}</td>
                <td class="px-4 py-2.5">
                  <span :class="['text-xs', isExpired(inv.expires_at) ? 'text-red-400' : 'text-[var(--app-muted)]']">
                    {{ formatDate(inv.expires_at) }}
                  </span>
                </td>
                <td v-if="canManageInvites" class="px-4 py-2.5">
                  <div class="flex items-center justify-end gap-2">
                    <Button variant="ghost" size="xs" label="Resend" @click="handleResend(inv)">
                      <template #leading>
                        <RotateCcw class="size-3" />
                      </template>
                    </Button>
                    <Button variant="ghost" color="error" size="xs" label="Revoke" @click="handleRevoke(inv.id)">
                      <template #leading>
                        <Ban class="size-3" />
                      </template>
                    </Button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </Card>
    </div>

    <!-- History -->
    <div v-if="historyInvites.length > 0">
      <button
        class="text-[11px] tracking-[0.12em] uppercase font-medium text-[var(--app-muted)] hover:text-[var(--app-foreground)] transition-colors mb-2 inline-flex items-center gap-1.5"
        @click="showHistory = !showHistory"
      >
        <span class="inline-block w-2 text-center">{{ showHistory ? '▾' : '▸' }}</span>
        History ({{ historyInvites.length }})
      </button>

      <Card v-if="showHistory">
        <div class="-mx-5 -mt-5 -mb-4">
          <table class="w-full">
            <thead>
              <tr class="border-b border-[var(--app-border)]">
                <th class="text-left text-[10px] tracking-[0.08em] uppercase font-medium text-[var(--app-muted)] px-4 py-2.5">Email</th>
                <th class="text-left text-[10px] tracking-[0.08em] uppercase font-medium text-[var(--app-muted)] px-4 py-2.5">Role</th>
                <th class="text-left text-[10px] tracking-[0.08em] uppercase font-medium text-[var(--app-muted)] px-4 py-2.5">Status</th>
                <th class="text-left text-[10px] tracking-[0.08em] uppercase font-medium text-[var(--app-muted)] px-4 py-2.5">Date</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-[var(--app-border)]">
              <tr v-for="inv in paginatedHistory" :key="inv.id">
                <td class="px-4 py-2.5 text-sm text-[var(--app-foreground)]">{{ inv.email }}</td>
                <td class="px-4 py-2.5">
                  <Badge color="neutral" size="xs">{{ inv.role }}</Badge>
                </td>
                <td class="px-4 py-2.5">
                  <Badge :color="statusBadgeColor(inv.status)" size="xs">{{ inv.status }}</Badge>
                </td>
                <td class="px-4 py-2.5 text-xs text-[var(--app-muted)]">{{ formatDate(inv.created_at) }}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <template v-if="historyPageCount > 1" #footer>
          <span class="text-[10px] tracking-[0.08em] uppercase text-[var(--app-muted)]">
            Page <strong class="text-[var(--app-foreground)]">{{ historyPage }}</strong> of {{ historyPageCount }}
            · {{ historyInvites.length }} total
          </span>
        </template>
        <template v-if="historyPageCount > 1" #footer-end>
          <div class="flex items-center gap-1">
            <Button
              variant="ghost"
              size="xs"
              :disabled="historyPage <= 1"
              @click="historyPage--"
            >
              <template #leading>
                <ChevronLeft class="size-3.5" />
              </template>
              Prev
            </Button>
            <Button
              variant="ghost"
              size="xs"
              :disabled="historyPage >= historyPageCount"
              @click="historyPage++"
            >
              Next
              <template #trailing>
                <ChevronRight class="size-3.5" />
              </template>
            </Button>
          </div>
        </template>
      </Card>
    </div>
  </div>
</template>
