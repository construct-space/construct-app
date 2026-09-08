<script setup lang="ts">
import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import { ArrowLeft, Pencil, Trash2, Shield, ShieldAlert, UsersRound } from 'lucide-vue-next'
import { Badge, Button, Card, Empty, Input, Select } from '@construct-space/ui'
import { useOrgData } from '@/spaces/org/composables/useOrgData'
import { useOrgPermissions } from '@/spaces/org/composables/useOrgPermissions'
import { useAuthStore } from '@/stores/auth'
import type { MemberStatus, OrgMember } from '@/types/org'
import ToolbarSlot from '@/components/common/ToolbarSlot.vue'

const props = defineProps<{ id: string }>()
const router = useRouter()
const authStore = useAuthStore()

const {
  getMemberById,
  updateMember,
  deleteMember,
  getDepartmentName,
  getMemberTeams,
  departments,
  roles: orgRoles,
} = useOrgData()
const { canEditMember, canEditMemberRole, canRemoveMember, isAdmin } = useOrgPermissions()

const editing = ref(false)
const confirmDelete = ref(false)

// Edit form state
const editName = ref('')
const editEmail = ref('')
const editTitle = ref('')
const editRoleId = ref('')
const editDepartmentId = ref<string>('')
const editStatus = ref<MemberStatus>('active')

const member = computed(() => getMemberById(props.id))
const memberTeams = computed(() => getMemberTeams(props.id))

function resolveRoleId(target: OrgMember): string {
  if (target.role_id) return target.role_id
  return orgRoles.value.find(role => role.name.toLowerCase() === target.role)?.id ?? ''
}

function startEdit() {
  if (!member.value) return
  editName.value = member.value.name
  editEmail.value = member.value.email
  editTitle.value = member.value.title
  editRoleId.value = resolveRoleId(member.value)
  editDepartmentId.value = member.value.department_id ?? ''
  editStatus.value = member.value.status
  editing.value = true
}

async function saveEdit() {
  if (!member.value) return
  const updates: Partial<OrgMember> = {
    name: editName.value.trim(),
    email: editEmail.value.trim(),
    title: editTitle.value.trim(),
    department_id: editDepartmentId.value || null,
    status: editStatus.value,
  }

  const changingOwnRole =
    canEditMemberRole(member.value.role)
    && member.value.user_id === authStore.user?.id
    && (editRoleId.value || resolveRoleId(member.value)) !== resolveRoleId(member.value)

  if (canEditMemberRole(member.value.role)) {
    updates.role_id = editRoleId.value || resolveRoleId(member.value) || null
  }

  await updateMember(props.id, updates)
  // If the current user just changed their OWN role, refresh auth scope so
  // authStore.roles / isOrgAdmin resync and admin-gated UI reacts without a
  // reload. authStore.roles is the canonical source the permission checks read.
  if (changingOwnRole) await authStore.refreshScope()
  editing.value = false
}

async function handleDelete() {
  const removingSelf = member.value?.user_id === authStore.user?.id
  await deleteMember(props.id)
  // Removing yourself from the org drops you back to personal scope — resync
  // so isOrgManaged/scope/roles update and the org UI disappears without a
  // manual reload.
  if (removingSelf) await authStore.refreshScope()
  router.push('/app/settings/org-members')
}

function getInitials(name: string): string {
  return name
    .split(' ')
    .map(w => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase()
}

function roleBadgeColor(role: string): 'primary' | 'error' | 'info' | 'success' | 'neutral' {
  switch (role) {
    case 'owner': return 'primary'
    case 'admin': return 'error'
    case 'pm': return 'info'
    case 'developer': return 'info'
    case 'member': return 'success'
    default: return 'neutral'
  }
}

function statusBadgeColor(status: MemberStatus): 'success' | 'neutral' | 'warning' {
  switch (status) {
    case 'active': return 'success'
    case 'inactive': return 'neutral'
    case 'pending_invite': return 'warning'
    default: return 'neutral'
  }
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}
</script>

<template>
  <div class="p-6 space-y-4">
    <ToolbarSlot v-if="member && !editing && canEditMember(id)" name="right">
      <Button variant="ghost" size="xs" label="Edit" @click="startEdit">
        <template #leading>
          <Pencil class="size-3.5" />
        </template>
      </Button>
    </ToolbarSlot>
    <!-- Back -->
    <button
      class="inline-flex items-center gap-1.5 text-[11px] tracking-[0.12em] uppercase text-[var(--app-muted)] hover:text-[var(--app-foreground)] transition-colors"
      @click="router.push('/app/settings/org-members')"
    >
      <ArrowLeft class="size-3.5" />
      Back to members
    </button>

    <!-- Not found -->
    <Card v-if="!member">
      <Empty
        icon="i-lucide-user-round"
        title="Member not found"
        description="This member may have been removed or the link is wrong."
      />
    </Card>

    <template v-else>
      <!-- Intro -->
      <Card variant="muted">
        <template #header>
          <div class="flex items-start gap-3">
            <div class="size-7 rounded-full bg-[color-mix(in_srgb,var(--app-accent)_12%,transparent)] flex items-center justify-center text-xs font-medium text-[var(--app-accent)] shrink-0 mt-0.5">
              {{ getInitials(member.name) }}
            </div>
            <div class="min-w-0 flex-1">
              <div class="flex items-center gap-2 flex-wrap">
                <h3 class="text-sm tracking-[0.08em] uppercase font-normal text-[var(--app-foreground)] leading-tight after:content-['.'] after:text-[var(--app-accent)]">{{ member.name }}</h3>
                <Badge :color="roleBadgeColor(member.role)" size="xs">{{ member.role }}</Badge>
                <Badge :color="statusBadgeColor(member.status)" size="xs">{{ member.status }}</Badge>
              </div>
              <p class="text-sm text-[var(--app-muted)] mt-0.5">{{ member.email }}</p>
            </div>
          </div>
        </template>
      </Card>

      <!-- View mode -->
      <Card v-if="!editing">
        <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <div class="text-[10px] tracking-[0.08em] uppercase text-[var(--app-muted)]">Title</div>
            <div class="text-sm text-[var(--app-foreground)] mt-0.5">{{ member.title || '—' }}</div>
          </div>
          <div>
            <div class="text-[10px] tracking-[0.08em] uppercase text-[var(--app-muted)]">Department</div>
            <div class="text-sm text-[var(--app-foreground)] mt-0.5">{{ member.department_id ? getDepartmentName(member.department_id) : '—' }}</div>
          </div>
          <div>
            <div class="text-[10px] tracking-[0.08em] uppercase text-[var(--app-muted)]">Teams</div>
            <div class="text-sm text-[var(--app-foreground)] mt-0.5">{{ memberTeams.length }}</div>
          </div>
          <div>
            <div class="text-[10px] tracking-[0.08em] uppercase text-[var(--app-muted)]">Joined</div>
            <div class="text-sm text-[var(--app-foreground)] mt-0.5">{{ formatDate(member.joined_at) }}</div>
          </div>
          <div>
            <div class="text-[10px] tracking-[0.08em] uppercase text-[var(--app-muted)]">Last active</div>
            <div class="text-sm text-[var(--app-foreground)] mt-0.5">{{ formatDate(member.last_active_at) }}</div>
          </div>
        </div>
      </Card>

      <!-- Edit mode -->
      <Card v-else>
        <template #header>
          <h4 class="text-sm tracking-[0.08em] uppercase font-normal text-[var(--app-foreground)] leading-tight after:content-['.'] after:text-[var(--app-accent)]">Edit member</h4>
        </template>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label class="block text-[10px] tracking-[0.08em] uppercase text-[var(--app-muted)] mb-1">Name</label>
            <Input v-model="editName" size="sm" />
          </div>
          <div>
            <label class="block text-[10px] tracking-[0.08em] uppercase text-[var(--app-muted)] mb-1">Email</label>
            <Input v-model="editEmail" type="email" size="sm" />
          </div>
          <div>
            <label class="block text-[10px] tracking-[0.08em] uppercase text-[var(--app-muted)] mb-1">Title</label>
            <Input v-model="editTitle" size="sm" />
          </div>
          <div v-if="member && canEditMemberRole(member.role)">
            <label class="block text-[10px] tracking-[0.08em] uppercase text-[var(--app-muted)] mb-1">Role</label>
            <Select
              v-model="editRoleId"
              :options="orgRoles.filter(r => r.name !== 'Owner').map(r => ({ value: r.id, label: r.name }))"
              size="sm"
            />
          </div>
          <div v-if="isAdmin">
            <label class="block text-[10px] tracking-[0.08em] uppercase text-[var(--app-muted)] mb-1">Department</label>
            <Select
              v-model="editDepartmentId"
              :options="[{ value: '', label: 'None' }, ...departments.map(d => ({ value: d.id, label: d.name }))]"
              size="sm"
            />
          </div>
          <div v-if="isAdmin">
            <label class="block text-[10px] tracking-[0.08em] uppercase text-[var(--app-muted)] mb-1">Status</label>
            <Select
              v-model="editStatus"
              :options="[{ value: 'active', label: 'Active' }, { value: 'inactive', label: 'Inactive' }]"
              size="sm"
            />
          </div>
        </div>

        <template #footer-end>
          <div class="flex items-center gap-2">
            <Button variant="ghost" size="sm" label="Cancel" @click="editing = false" />
            <Button size="sm" label="Save changes" @click="saveEdit" />
          </div>
        </template>
      </Card>

      <!-- Teams section -->
      <div>
        <h4 class="text-[11px] tracking-[0.12em] uppercase font-medium text-[var(--app-muted)] mb-2">Teams ({{ memberTeams.length }})</h4>

        <Card v-if="memberTeams.length === 0">
          <Empty
            icon="i-lucide-users-round"
            title="Not on any team"
            description="This member has not been added to any team yet."
          />
        </Card>

        <div v-else class="space-y-3">
          <Card
            v-for="team in memberTeams"
            :key="team.id"
            interactive
            @click="router.push(`/app/settings/org-teams/${team.id}`)"
          >
            <template #header>
              <div class="flex items-start gap-3">
                <UsersRound class="size-5 text-[var(--app-muted)] mt-0.5 shrink-0" />
                <div class="min-w-0 flex-1">
                  <h4 class="text-sm tracking-[0.08em] uppercase font-normal text-[var(--app-foreground)] leading-tight after:content-['.'] after:text-[var(--app-accent)]">{{ team.name }}</h4>
                  <p v-if="team.description" class="text-xs text-[var(--app-muted)] mt-1 line-clamp-2">{{ team.description }}</p>
                </div>
              </div>
            </template>
            <template v-if="team.lead_id === member.id" #accessory>
              <Badge color="primary" size="xs">
                <template #leading>
                  <Shield class="size-3" />
                </template>
                Lead
              </Badge>
            </template>
          </Card>
        </div>
      </div>

      <!-- Danger zone -->
      <Card v-if="member && canRemoveMember(member.role)">
        <template #header>
          <div class="flex items-start gap-3">
            <ShieldAlert class="size-5 text-red-400 mt-0.5 shrink-0" />
            <div class="min-w-0 flex-1">
              <h4 class="text-sm tracking-[0.08em] uppercase font-normal text-red-400 leading-tight after:content-['.']">Danger zone</h4>
              <p class="text-xs text-[var(--app-muted)] mt-0.5">Permanently remove this member from the organization.</p>
            </div>
          </div>
        </template>
        <template v-if="!confirmDelete" #accessory>
          <Button variant="ghost" color="error" size="xs" label="Remove member" @click="confirmDelete = true">
            <template #leading>
              <Trash2 class="size-3.5" />
            </template>
          </Button>
        </template>

        <template v-if="confirmDelete">
          <div class="flex items-center justify-end gap-2">
            <Button variant="ghost" size="sm" label="Cancel" @click="confirmDelete = false" />
            <Button color="error" size="sm" label="Confirm remove" @click="handleDelete" />
          </div>
        </template>
      </Card>
    </template>
  </div>
</template>
