<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { Briefcase, Plus } from 'lucide-vue-next'
import { Badge, Button, Card, Empty, Input } from '@construct-space/ui'
import { useOrgData } from '@/spaces/org/composables/useOrgData'
import { useOrgPermissions } from '@/spaces/org/composables/useOrgPermissions'
import ToolbarSlot from '@/components/common/ToolbarSlot.vue'

const router = useRouter()
const {
  departments,
  createDepartment,
  getMembersByDepartment,
  getTeamsByDepartment,
  getMemberName,
} = useOrgData()
const { canManageDepartments } = useOrgPermissions()

const showAddForm = ref(false)
const newName = ref('')
const newDescription = ref('')
const newCode = ref('')

function handleAdd() {
  const name = newName.value.trim()
  if (!name) return
  createDepartment({
    name,
    description: newDescription.value.trim() || undefined,
    code: newCode.value.trim() || undefined,
  })
  newName.value = ''
  newDescription.value = ''
  newCode.value = ''
  showAddForm.value = false
}

function deptMemberCount(deptId: string): number {
  return getMembersByDepartment(deptId).length
}

function deptTeamCount(deptId: string): number {
  return getTeamsByDepartment(deptId).length
}

function deptHeadName(headId: string | null): string {
  if (!headId) return '—'
  return getMemberName(headId)
}
</script>

<template>
  <div class="p-6 space-y-4">
    <ToolbarSlot name="right">
      <Button
        v-if="canManageDepartments"
        size="xs"
        :label="showAddForm ? 'Close' : 'Add department'"
        @click="showAddForm = !showAddForm"
      >
        <template #leading>
          <Plus class="size-3.5" />
        </template>
      </Button>
    </ToolbarSlot>
    <!-- Intro -->
    <Card variant="muted">
      <template #header>
        <div class="flex items-start gap-3 min-w-0 flex-1">
          <Briefcase class="size-5 text-[var(--app-muted)] mt-0.5 shrink-0" />
          <div class="min-w-0 flex-1">
            <h3 class="text-sm tracking-[0.08em] uppercase font-normal text-[var(--app-foreground)] leading-tight after:content-['.'] after:text-[var(--app-accent)]">Departments <span class="text-[var(--app-muted)]">({{ departments.length }})</span></h3>
            <p class="text-sm text-[var(--app-muted)] mt-0.5">Group members and teams under functional units with an owner.</p>
          </div>
        </div>
      </template>
    </Card>

    <!-- Add department form -->
    <Card v-if="canManageDepartments && showAddForm">
      <template #header>
        <div class="min-w-0 flex-1">
          <h4 class="text-sm tracking-[0.08em] uppercase font-normal text-[var(--app-foreground)] leading-tight after:content-['.'] after:text-[var(--app-accent)]">New department</h4>
          <p class="text-xs text-[var(--app-muted)] mt-0.5">Short codes make departments easier to scan in lists and reports.</p>
        </div>
      </template>

      <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div>
          <label class="block text-[10px] tracking-[0.08em] uppercase text-[var(--app-muted)] mb-1">Name</label>
          <Input v-model="newName" placeholder="Department name" size="sm" @keydown.enter="handleAdd" />
        </div>
        <div>
          <label class="block text-[10px] tracking-[0.08em] uppercase text-[var(--app-muted)] mb-1">Code</label>
          <Input v-model="newCode" placeholder="ENG, OPS, MKT…" size="sm" @keydown.enter="handleAdd" />
        </div>
        <div>
          <label class="block text-[10px] tracking-[0.08em] uppercase text-[var(--app-muted)] mb-1">Description</label>
          <Input v-model="newDescription" placeholder="Optional" size="sm" @keydown.enter="handleAdd" />
        </div>
      </div>

      <template #footer-end>
        <div class="flex items-center gap-2">
          <Button variant="ghost" size="sm" label="Cancel" @click="showAddForm = false" />
          <Button
            size="sm"
            label="Create department"
            :disabled="!newName.trim()"
            @click="handleAdd"
          />
        </div>
      </template>
    </Card>

    <!-- Empty state -->
    <Card v-if="departments.length === 0 && !showAddForm">
      <Empty
        icon="i-lucide-briefcase"
        title="No departments yet"
        description="Create your first department to organize members and teams by function."
      >
        <Button v-if="canManageDepartments" size="sm" label="Add department" @click="showAddForm = true">
          <template #leading>
            <Plus class="size-3.5" />
          </template>
        </Button>
      </Empty>
    </Card>

    <!-- Department grid -->
    <div v-else-if="departments.length > 0" class="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(260px,1fr))]">
      <Card
        v-for="dept in departments"
        :key="dept.id"
        interactive
        @click="router.push(`/app/settings/org-departments/${dept.id}`)"
      >
        <template #header>
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-2 flex-wrap">
              <h4 class="text-sm tracking-[0.08em] uppercase font-normal text-[var(--app-foreground)] leading-tight after:content-['.'] after:text-[var(--app-accent)]">{{ dept.name }}</h4>
              <Badge v-if="dept.code" color="neutral" size="xs">{{ dept.code }}</Badge>
            </div>
            <p v-if="dept.description" class="text-xs text-[var(--app-muted)] mt-1 line-clamp-2">{{ dept.description }}</p>
          </div>
        </template>

        <div class="flex items-center gap-3 text-xs text-[var(--app-muted)] flex-wrap">
          <span>{{ deptMemberCount(dept.id) }} members</span>
          <span>{{ deptTeamCount(dept.id) }} teams</span>
        </div>

        <template v-if="dept.head_id" #footer>
          <span class="text-[10px] tracking-[0.08em] uppercase text-[var(--app-muted)]">
            Head · <strong class="text-[var(--app-foreground)]">{{ deptHeadName(dept.head_id) }}</strong>
          </span>
        </template>
      </Card>
    </div>
  </div>
</template>
