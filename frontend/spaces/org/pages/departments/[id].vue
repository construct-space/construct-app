<script setup lang="ts">
import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import { ArrowLeft, Pencil, Trash2, Briefcase, UsersRound, Plus, ShieldAlert } from 'lucide-vue-next'
import { Badge, Button, Card, Empty, Input, Select } from '@construct-space/ui'
import { useOrgData } from '@/spaces/org/composables/useOrgData'
import { useOrgPermissions } from '@/spaces/org/composables/useOrgPermissions'
import ToolbarSlot from '@/components/common/ToolbarSlot.vue'

const props = defineProps<{ id: string }>()
const router = useRouter()

const {
  getDepartmentById,
  updateDepartment,
  deleteDepartment,
  getMembersByDepartment,
  getTeamsByDepartment,
  getMemberName,
  createTeam,
} = useOrgData()
const { canManageDepartments } = useOrgPermissions()

const editing = ref(false)
const confirmDelete = ref(false)

const editName = ref('')
const editDescription = ref('')
const editCode = ref('')
const editHeadId = ref('')

const department = computed(() => getDepartmentById(props.id))
const deptMembers = computed(() => getMembersByDepartment(props.id))
const deptTeams = computed(() => getTeamsByDepartment(props.id))

const headOptions = computed(() => [
  { value: '', label: 'None' },
  ...deptMembers.value.map(m => ({ value: m.id, label: m.name })),
])

const leadOptions = computed(() => [
  { value: '', label: 'No lead' },
  ...deptMembers.value.map(m => ({ value: m.id, label: m.name })),
])

function startEdit() {
  if (!department.value) return
  editName.value = department.value.name
  editDescription.value = department.value.description
  editCode.value = department.value.code
  editHeadId.value = department.value.head_id ?? ''
  editing.value = true
}

function saveEdit() {
  if (!department.value) return
  updateDepartment(props.id, {
    name: editName.value.trim(),
    description: editDescription.value.trim(),
    code: editCode.value.trim(),
    head_id: editHeadId.value || null,
  })
  editing.value = false
}

function handleDelete() {
  deleteDepartment(props.id)
  router.push('/app/settings/org-departments')
}

function getInitials(name: string): string {
  return name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase()
}

// Add team inline form
const showAddTeamForm = ref(false)
const newTeamName = ref('')
const newTeamDescription = ref('')
const newTeamLeadId = ref('')
const isCreatingTeam = ref(false)

async function handleAddTeam() {
  const name = newTeamName.value.trim()
  if (!name) return
  isCreatingTeam.value = true
  try {
    await createTeam({
      name,
      description: newTeamDescription.value.trim() || undefined,
      department_id: props.id,
      lead_id: newTeamLeadId.value || undefined,
    })
    newTeamName.value = ''
    newTeamDescription.value = ''
    newTeamLeadId.value = ''
    showAddTeamForm.value = false
  } finally {
    isCreatingTeam.value = false
  }
}
</script>

<template>
  <div class="p-6 space-y-4">
    <ToolbarSlot v-if="department && !editing && canManageDepartments" name="right">
      <Button variant="ghost" size="xs" label="Edit" @click="startEdit">
        <template #leading>
          <Pencil class="size-3.5" />
        </template>
      </Button>
    </ToolbarSlot>
    <!-- Back -->
    <button
      class="inline-flex items-center gap-1.5 text-[11px] tracking-[0.12em] uppercase text-[var(--app-muted)] hover:text-[var(--app-foreground)] transition-colors"
      @click="router.push('/app/settings/org-departments')"
    >
      <ArrowLeft class="size-3.5" />
      Back to departments
    </button>

    <!-- Not found -->
    <Card v-if="!department">
      <Empty
        icon="i-lucide-briefcase"
        title="Department not found"
        description="This department may have been deleted or the link is wrong."
      />
    </Card>

    <template v-else>
      <!-- Intro -->
      <Card variant="muted">
        <template #header>
          <div class="flex items-start gap-3">
            <Briefcase class="size-5 text-[var(--app-muted)] mt-0.5 shrink-0" />
            <div class="min-w-0 flex-1">
              <div class="flex items-center gap-2 flex-wrap">
                <h3 class="text-sm tracking-[0.08em] uppercase font-normal text-[var(--app-foreground)] leading-tight after:content-['.'] after:text-[var(--app-accent)]">{{ department.name }}</h3>
                <Badge v-if="department.code" color="neutral" size="xs">{{ department.code }}</Badge>
              </div>
              <p v-if="department.description" class="text-sm text-[var(--app-muted)] mt-0.5">{{ department.description }}</p>
            </div>
          </div>
        </template>
      </Card>

      <!-- View / Edit -->
      <Card v-if="!editing">
        <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <div class="text-[10px] tracking-[0.08em] uppercase text-[var(--app-muted)]">Code</div>
            <div class="text-sm text-[var(--app-foreground)] mt-0.5">{{ department.code || '—' }}</div>
          </div>
          <div>
            <div class="text-[10px] tracking-[0.08em] uppercase text-[var(--app-muted)]">Head</div>
            <div class="text-sm text-[var(--app-foreground)] mt-0.5">{{ department.head_id ? getMemberName(department.head_id) : '—' }}</div>
          </div>
          <div>
            <div class="text-[10px] tracking-[0.08em] uppercase text-[var(--app-muted)]">Members</div>
            <div class="text-sm text-[var(--app-foreground)] mt-0.5">{{ deptMembers.length }}</div>
          </div>
        </div>
      </Card>

      <Card v-else>
        <template #header>
          <h4 class="text-sm tracking-[0.08em] uppercase font-normal text-[var(--app-foreground)] leading-tight after:content-['.'] after:text-[var(--app-accent)]">Edit department</h4>
        </template>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label class="block text-[10px] tracking-[0.08em] uppercase text-[var(--app-muted)] mb-1">Name</label>
            <Input v-model="editName" size="sm" />
          </div>
          <div>
            <label class="block text-[10px] tracking-[0.08em] uppercase text-[var(--app-muted)] mb-1">Code</label>
            <Input v-model="editCode" size="sm" />
          </div>
          <div class="md:col-span-2">
            <label class="block text-[10px] tracking-[0.08em] uppercase text-[var(--app-muted)] mb-1">Description</label>
            <Input v-model="editDescription" size="sm" />
          </div>
          <div class="md:col-span-2">
            <label class="block text-[10px] tracking-[0.08em] uppercase text-[var(--app-muted)] mb-1">Department head</label>
            <Select v-model="editHeadId" :options="headOptions" size="sm" />
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
        <div class="flex items-center justify-between mb-2">
          <h4 class="text-[11px] tracking-[0.12em] uppercase font-medium text-[var(--app-muted)]">Teams ({{ deptTeams.length }})</h4>
          <Button
            v-if="canManageDepartments"
            size="xs"
            :label="showAddTeamForm ? 'Close' : 'Add team'"
            @click="showAddTeamForm = !showAddTeamForm"
          >
            <template #leading>
              <Plus class="size-3.5" />
            </template>
          </Button>
        </div>

        <!-- Inline add-team form -->
        <Card v-if="canManageDepartments && showAddTeamForm" class="mb-3">
          <template #header>
            <div class="min-w-0 flex-1">
              <h4 class="text-sm tracking-[0.08em] uppercase font-normal text-[var(--app-foreground)] leading-tight after:content-['.'] after:text-[var(--app-accent)]">New team</h4>
              <p class="text-xs text-[var(--app-muted)] mt-0.5">Teams belong to this department. A lead is optional and can be set later.</p>
            </div>
          </template>

          <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <label class="block text-[10px] tracking-[0.08em] uppercase text-[var(--app-muted)] mb-1">Name</label>
              <Input v-model="newTeamName" placeholder="Team name" size="sm" @keydown.enter="handleAddTeam" />
            </div>
            <div>
              <label class="block text-[10px] tracking-[0.08em] uppercase text-[var(--app-muted)] mb-1">Description</label>
              <Input v-model="newTeamDescription" placeholder="Optional" size="sm" @keydown.enter="handleAddTeam" />
            </div>
            <div>
              <label class="block text-[10px] tracking-[0.08em] uppercase text-[var(--app-muted)] mb-1">Lead</label>
              <Select v-model="newTeamLeadId" :options="leadOptions" size="sm" />
            </div>
          </div>

          <template #footer-end>
            <div class="flex items-center gap-2">
              <Button variant="ghost" size="sm" label="Cancel" @click="showAddTeamForm = false" />
              <Button
                size="sm"
                label="Create team"
                :loading="isCreatingTeam"
                :disabled="!newTeamName.trim()"
                @click="handleAddTeam"
              />
            </div>
          </template>
        </Card>

        <Card v-if="deptTeams.length === 0">
          <Empty
            icon="i-lucide-users-round"
            title="No teams in this department"
            :description="canManageDepartments ? 'Organize members by grouping them into teams within this department.' : 'Nothing here yet.'"
          >
            <Button v-if="canManageDepartments && !showAddTeamForm" size="sm" label="Add team" @click="showAddTeamForm = true">
              <template #leading>
                <Plus class="size-3.5" />
              </template>
            </Button>
          </Empty>
        </Card>

        <div v-else class="space-y-3">
          <Card
            v-for="team in deptTeams"
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
            <template v-if="team.lead_id" #accessory>
              <span class="text-[10px] tracking-[0.08em] uppercase text-[var(--app-muted)]">
                Lead · <strong class="text-[var(--app-foreground)]">{{ getMemberName(team.lead_id) }}</strong>
              </span>
            </template>
          </Card>
        </div>
      </div>

      <!-- Members section -->
      <div>
        <h4 class="text-[11px] tracking-[0.12em] uppercase font-medium text-[var(--app-muted)] mb-2">Members ({{ deptMembers.length }})</h4>

        <Card v-if="deptMembers.length === 0">
          <Empty
            icon="i-lucide-users"
            title="No members in this department"
            description="Assign members to this department from the Members page."
          />
        </Card>

        <Card v-else>
          <div class="-mx-5 -my-5">
            <table class="w-full">
              <thead>
                <tr class="border-b border-[var(--app-border)]">
                  <th class="text-left text-[10px] tracking-[0.08em] uppercase font-medium text-[var(--app-muted)] px-4 py-2.5">Name</th>
                  <th class="text-left text-[10px] tracking-[0.08em] uppercase font-medium text-[var(--app-muted)] px-4 py-2.5">Email</th>
                  <th class="text-left text-[10px] tracking-[0.08em] uppercase font-medium text-[var(--app-muted)] px-4 py-2.5">Role</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-[var(--app-border)]">
                <tr
                  v-for="m in deptMembers"
                  :key="m.id"
                  class="hover:bg-[var(--app-canvas-bg)] cursor-pointer transition-colors"
                  @click="router.push(`/app/settings/org-members/${m.id}`)"
                >
                  <td class="px-4 py-2.5">
                    <div class="flex items-center gap-2.5">
                      <div class="size-6 rounded-full bg-[color-mix(in_srgb,var(--app-accent)_12%,transparent)] flex items-center justify-center text-[10px] font-medium text-[var(--app-accent)]">
                        {{ getInitials(m.name) }}
                      </div>
                      <span class="text-sm text-[var(--app-foreground)]">{{ m.name }}</span>
                    </div>
                  </td>
                  <td class="px-4 py-2.5 text-sm text-[var(--app-muted)]">{{ m.email }}</td>
                  <td class="px-4 py-2.5 text-xs text-[var(--app-muted)]">{{ m.role }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      <!-- Danger zone -->
      <Card v-if="canManageDepartments">
        <template #header>
          <div class="flex items-start gap-3">
            <ShieldAlert class="size-5 text-red-400 mt-0.5 shrink-0" />
            <div class="min-w-0 flex-1">
              <h4 class="text-sm tracking-[0.08em] uppercase font-normal text-red-400 leading-tight after:content-['.']">Danger zone</h4>
              <p class="text-xs text-[var(--app-muted)] mt-0.5">Delete this department. Members will be unassigned but not removed.</p>
            </div>
          </div>
        </template>
        <template v-if="!confirmDelete" #accessory>
          <Button variant="ghost" color="error" size="xs" label="Delete department" @click="confirmDelete = true">
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
