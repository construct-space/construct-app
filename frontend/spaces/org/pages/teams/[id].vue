<script setup lang="ts">
import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import { ArrowLeft, Pencil, Trash2, UserPlus, UserMinus, UsersRound, ShieldAlert } from 'lucide-vue-next'
import { Badge, Button, Card, Empty, Input, Select } from '@construct-space/ui'
import { useOrgData } from '@/spaces/org/composables/useOrgData'
import { useOrgPermissions } from '@/spaces/org/composables/useOrgPermissions'
import ToolbarSlot from '@/components/common/ToolbarSlot.vue'

const props = defineProps<{ id: string }>()
const router = useRouter()

const {
  getTeamById,
  updateTeam,
  deleteTeam,
  getTeamMembers,
  addMemberToTeam,
  removeMemberFromTeam,
  getDepartmentName,
  getMemberName,
  members,
  departments,
} = useOrgData()
const { canManageTeams } = useOrgPermissions()

const editing = ref(false)
const confirmDelete = ref(false)
const showAddMember = ref(false)
const addMemberId = ref('')

const editName = ref('')
const editDescription = ref('')
const editDepartmentId = ref('')
const editLeadId = ref('')

const team = computed(() => getTeamById(props.id))
const teamMembersList = computed(() => getTeamMembers(props.id))

const availableMembers = computed(() => {
  const currentIds = new Set(teamMembersList.value.map(m => m.id))
  return members.value.filter(m => !currentIds.has(m.id))
})

function startEdit() {
  if (!team.value) return
  editName.value = team.value.name
  editDescription.value = team.value.description
  editDepartmentId.value = team.value.department_id ?? ''
  editLeadId.value = team.value.lead_id ?? ''
  editing.value = true
}

function saveEdit() {
  if (!team.value) return
  updateTeam(props.id, {
    name: editName.value.trim(),
    description: editDescription.value.trim(),
    department_id: editDepartmentId.value || null,
    lead_id: editLeadId.value || null,
  })
  editing.value = false
}

function handleAddMember() {
  if (!addMemberId.value) return
  addMemberToTeam(props.id, addMemberId.value)
  addMemberId.value = ''
  showAddMember.value = false
}

function handleRemoveMember(memberId: string) {
  removeMemberFromTeam(props.id, memberId)
}

function handleDelete() {
  deleteTeam(props.id)
  router.push('/app/settings/org-departments')
}

function getInitials(name: string): string {
  return name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase()
}
</script>

<template>
  <div class="p-6 space-y-4">
    <ToolbarSlot v-if="team && !editing && canManageTeams" name="right">
      <Button variant="ghost" size="xs" label="Edit" @click="startEdit">
        <template #leading>
          <Pencil class="size-3.5" />
        </template>
      </Button>
    </ToolbarSlot>
    <!-- Back -->
    <button
      class="inline-flex items-center gap-1.5 text-[11px] tracking-[0.12em] uppercase text-[var(--app-muted)] hover:text-[var(--app-foreground)] transition-colors"
      @click="router.back()"
    >
      <ArrowLeft class="size-3.5" />
      Back
    </button>

    <!-- Not found -->
    <Card v-if="!team">
      <Empty
        icon="i-lucide-users-round"
        title="Team not found"
        description="This team may have been deleted or the link is wrong."
      />
    </Card>

    <template v-else>
      <!-- Intro -->
      <Card variant="muted">
        <template #header>
          <div class="flex items-start gap-3">
            <UsersRound class="size-5 text-[var(--app-muted)] mt-0.5 shrink-0" />
            <div class="min-w-0 flex-1">
              <h3 class="text-sm tracking-[0.08em] uppercase font-normal text-[var(--app-foreground)] leading-tight after:content-['.'] after:text-[var(--app-accent)]">{{ team.name }}</h3>
              <p v-if="team.description" class="text-sm text-[var(--app-muted)] mt-0.5">{{ team.description }}</p>
            </div>
          </div>
        </template>
      </Card>

      <!-- View / Edit -->
      <Card v-if="!editing">
        <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <div class="text-[10px] tracking-[0.08em] uppercase text-[var(--app-muted)]">Department</div>
            <div class="text-sm text-[var(--app-foreground)] mt-0.5">{{ team.department_id ? getDepartmentName(team.department_id) : '—' }}</div>
          </div>
          <div>
            <div class="text-[10px] tracking-[0.08em] uppercase text-[var(--app-muted)]">Lead</div>
            <div class="text-sm text-[var(--app-foreground)] mt-0.5">{{ team.lead_id ? getMemberName(team.lead_id) : '—' }}</div>
          </div>
          <div>
            <div class="text-[10px] tracking-[0.08em] uppercase text-[var(--app-muted)]">Members</div>
            <div class="text-sm text-[var(--app-foreground)] mt-0.5">{{ teamMembersList.length }}</div>
          </div>
        </div>
      </Card>

      <Card v-else>
        <template #header>
          <h4 class="text-sm tracking-[0.08em] uppercase font-normal text-[var(--app-foreground)] leading-tight after:content-['.'] after:text-[var(--app-accent)]">Edit team</h4>
        </template>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label class="block text-[10px] tracking-[0.08em] uppercase text-[var(--app-muted)] mb-1">Name</label>
            <Input v-model="editName" size="sm" />
          </div>
          <div>
            <label class="block text-[10px] tracking-[0.08em] uppercase text-[var(--app-muted)] mb-1">Department</label>
            <Select
              v-model="editDepartmentId"
              :options="[{ value: '', label: 'None' }, ...departments.map(d => ({ value: d.id, label: d.name }))]"
              size="sm"
            />
          </div>
          <div class="md:col-span-2">
            <label class="block text-[10px] tracking-[0.08em] uppercase text-[var(--app-muted)] mb-1">Description</label>
            <Input v-model="editDescription" size="sm" />
          </div>
          <div class="md:col-span-2">
            <label class="block text-[10px] tracking-[0.08em] uppercase text-[var(--app-muted)] mb-1">Team lead</label>
            <Select
              v-model="editLeadId"
              :options="[{ value: '', label: 'None' }, ...teamMembersList.map(m => ({ value: m.id, label: m.name }))]"
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

      <!-- Team members -->
      <div>
        <div class="flex items-center justify-between mb-2">
          <h4 class="text-[11px] tracking-[0.12em] uppercase font-medium text-[var(--app-muted)]">Team members ({{ teamMembersList.length }})</h4>
          <Button
            v-if="canManageTeams"
            size="xs"
            :label="showAddMember ? 'Close' : 'Add member'"
            @click="showAddMember = !showAddMember"
          >
            <template #leading>
              <UserPlus class="size-3.5" />
            </template>
          </Button>
        </div>

        <!-- Inline add-member form -->
        <Card v-if="canManageTeams && showAddMember" class="mb-3">
          <template #header>
            <div class="min-w-0 flex-1">
              <h4 class="text-sm tracking-[0.08em] uppercase font-normal text-[var(--app-foreground)] leading-tight after:content-['.'] after:text-[var(--app-accent)]">Add member</h4>
              <p class="text-xs text-[var(--app-muted)] mt-0.5">Select an existing org member to add to this team.</p>
            </div>
          </template>

          <div>
            <label class="block text-[10px] tracking-[0.08em] uppercase text-[var(--app-muted)] mb-1">Member</label>
            <Select
              v-model="addMemberId"
              :options="[{ value: '', label: 'Select a member…' }, ...availableMembers.map(m => ({ value: m.id, label: `${m.name} (${m.email})` }))]"
              size="sm"
            />
          </div>

          <template #footer-end>
            <div class="flex items-center gap-2">
              <Button variant="ghost" size="sm" label="Cancel" @click="showAddMember = false" />
              <Button
                size="sm"
                label="Add"
                :disabled="!addMemberId"
                @click="handleAddMember"
              />
            </div>
          </template>
        </Card>

        <Card v-if="teamMembersList.length === 0">
          <Empty
            icon="i-lucide-users"
            title="No members in this team yet"
            :description="canManageTeams ? 'Add members from the organization directory.' : 'Nothing here yet.'"
          >
            <Button v-if="canManageTeams && !showAddMember" size="sm" label="Add member" @click="showAddMember = true">
              <template #leading>
                <UserPlus class="size-3.5" />
              </template>
            </Button>
          </Empty>
        </Card>

        <Card v-else>
          <div class="-mx-5 -my-5">
            <div class="divide-y divide-[var(--app-border)]">
              <div
                v-for="m in teamMembersList"
                :key="m.id"
                class="px-5 py-2.5 flex items-center justify-between gap-3"
              >
                <div
                  class="flex items-center gap-2.5 min-w-0 cursor-pointer hover:opacity-80 transition-opacity"
                  @click="router.push(`/app/settings/org-members/${m.id}`)"
                >
                  <div class="size-7 rounded-full bg-[color-mix(in_srgb,var(--app-accent)_12%,transparent)] flex items-center justify-center text-[11px] font-medium text-[var(--app-accent)] shrink-0">
                    {{ getInitials(m.name) }}
                  </div>
                  <div class="min-w-0">
                    <div class="text-sm text-[var(--app-foreground)] truncate">{{ m.name }}</div>
                    <div class="text-xs text-[var(--app-muted)] truncate">{{ m.email }}</div>
                  </div>
                </div>
                <div class="flex items-center gap-2 shrink-0">
                  <Badge v-if="team.lead_id === m.id" color="primary" size="xs">Lead</Badge>
                  <button
                    v-if="canManageTeams"
                    class="text-[var(--app-muted)] hover:text-red-400 transition-colors"
                    title="Remove from team"
                    @click="handleRemoveMember(m.id)"
                  >
                    <UserMinus class="size-3.5" />
                  </button>
                </div>
              </div>
            </div>
          </div>
        </Card>
      </div>

      <!-- Danger zone -->
      <Card v-if="canManageTeams">
        <template #header>
          <div class="flex items-start gap-3">
            <ShieldAlert class="size-5 text-red-400 mt-0.5 shrink-0" />
            <div class="min-w-0 flex-1">
              <h4 class="text-sm tracking-[0.08em] uppercase font-normal text-red-400 leading-tight after:content-['.']">Danger zone</h4>
              <p class="text-xs text-[var(--app-muted)] mt-0.5">Delete this team permanently. Members will not be removed from the organization.</p>
            </div>
          </div>
        </template>
        <template v-if="!confirmDelete" #accessory>
          <Button variant="ghost" color="error" size="xs" label="Delete team" @click="confirmDelete = true">
            <template #leading>
              <Trash2 class="size-3.5" />
            </template>
          </Button>
        </template>

        <template v-if="confirmDelete">
          <div class="flex items-center justify-end gap-2">
            <Button variant="ghost" size="sm" label="Cancel" @click="confirmDelete = false" />
            <Button color="error" size="sm" label="Confirm delete" @click="handleDelete" />
          </div>
        </template>
      </Card>
    </template>
  </div>
</template>
