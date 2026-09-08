<script setup lang="ts">
/**
 * OrgRoles — pick a role to view or edit its permissions.
 * Replaces the big matrix with a list-of-roles + single-role permission
 * panel. Each role card has Edit / Delete in its accessory; built-in
 * roles lose Delete, Owner loses Edit entirely.
 */
import { ref, computed, watch } from 'vue'
import { Shield, Plus, Pencil, Lock, ShieldAlert } from 'lucide-vue-next'
import { Badge, Button, Card, Empty, Input, Modal, Switch } from '@construct-space/ui'
import { useOrgData } from '@/spaces/org/composables/useOrgData'
import { useOrgPermissions } from '@/spaces/org/composables/useOrgPermissions'
import type { OrgRole, PermissionDef } from '@/types/org'
import ToolbarSlot from '@/components/common/ToolbarSlot.vue'

const {
  roles,
  permissions,
  fetchRoles: _fetchRoles,
  createRole,
  updateRole,
  deleteRole,
} = useOrgData()
const { canManageRoles } = useOrgPermissions()

// --- Create role ---
const showCreateModal = ref(false)
const newName = ref('')
const newDescription = ref('')
const isCreating = ref(false)

// --- Selected role + edit state ---
const selectedRoleId = ref<string | null>(null)
const isEditMode = ref(false)
const editDescription = ref('')
const editPermissions = ref<string[]>([])

const selectedRole = computed(() =>
  roles.value.find(r => r.id === selectedRoleId.value) ?? null,
)

// --- Delete confirmation ---
const deletingRoleId = ref<string | null>(null)

// Group permissions by group label
const permissionGroups = computed<{ group: string; perms: PermissionDef[] }[]>(() => {
  const groups: { group: string; perms: PermissionDef[] }[] = []
  const seen = new Set<string>()

  for (const perm of permissions.value) {
    if (!seen.has(perm.group)) {
      seen.add(perm.group)
      groups.push({ group: perm.group, perms: [] })
    }
    groups.find(g => g.group === perm.group)!.perms.push(perm)
  }

  return groups
})

function selectRole(role: OrgRole) {
  selectedRoleId.value = role.id
  // Clicking the card goes straight into edit mode when the user has
  // rights; otherwise it just reveals the read-only permissions panel.
  if (canEditRole(role)) {
    isEditMode.value = true
    editDescription.value = role.description
    editPermissions.value = [...role.permissions]
  } else {
    isEditMode.value = false
  }
}

function canEditRole(role: OrgRole): boolean {
  return canManageRoles.value && role.name !== 'Owner'
}

function canDeleteRole(role: OrgRole): boolean {
  return canManageRoles.value && !role.is_builtin
}

function startEdit(role: OrgRole) {
  if (!canEditRole(role)) return
  selectedRoleId.value = role.id
  isEditMode.value = true
  editDescription.value = role.description
  editPermissions.value = [...role.permissions]
}

function cancelEdit() {
  isEditMode.value = false
}

function togglePermission(permId: string) {
  const idx = editPermissions.value.indexOf(permId)
  if (idx >= 0) editPermissions.value.splice(idx, 1)
  else editPermissions.value.push(permId)
}

function saveEdit() {
  if (!selectedRole.value) return
  updateRole(selectedRole.value.id, {
    description: editDescription.value.trim(),
    permissions: editPermissions.value,
  })
  isEditMode.value = false
}

// --- Create ---
async function handleCreate() {
  const name = newName.value.trim()
  if (!name) return
  isCreating.value = true
  try {
    const role = await createRole({
      name,
      description: newDescription.value.trim(),
      permissions: [],
    })
    newName.value = ''
    newDescription.value = ''
    showCreateModal.value = false
    // Drop straight into permission-editing for the brand-new role.
    if (role) selectRole(role)
  } finally {
    isCreating.value = false
  }
}

// --- Delete ---
function confirmDelete(roleId: string) {
  deletingRoleId.value = roleId
}

function handleDelete() {
  if (!deletingRoleId.value) return
  deleteRole(deletingRoleId.value)
  if (selectedRoleId.value === deletingRoleId.value) {
    selectedRoleId.value = null
    isEditMode.value = false
  }
  deletingRoleId.value = null
}

// If the selected role vanishes (e.g. after delete), clear selection.
watch(selectedRole, (r) => {
  if (!r) {
    selectedRoleId.value = null
    isEditMode.value = false
  }
})
</script>

<template>
  <div class="p-6 space-y-4">
    <ToolbarSlot name="right">
      <Button
        v-if="canManageRoles"
        size="xs"
        label="Create role"
        @click="showCreateModal = true"
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
          <Shield class="size-5 text-[var(--app-muted)] mt-0.5 shrink-0" />
          <div class="min-w-0 flex-1">
            <h3 class="text-sm tracking-[0.08em] uppercase font-normal text-[var(--app-foreground)] leading-tight after:content-['.'] after:text-[var(--app-accent)]">Roles &amp; permissions <span class="text-[var(--app-muted)]">({{ roles.length }})</span></h3>
            <p class="text-sm text-[var(--app-muted)] mt-0.5">Pick a role to see its permissions. Built-in roles can have their permissions edited but cannot be renamed or deleted.</p>
          </div>
        </div>
      </template>
    </Card>

    <!-- Create role modal -->
    <Modal :open="showCreateModal" title="New role" @close="showCreateModal = false">
      <div class="space-y-4">
        <p class="text-xs text-[var(--app-muted)]">
          Start with a name and description. You'll set permissions on the next step.
        </p>
        <div>
          <label class="block text-[10px] tracking-[0.08em] uppercase text-[var(--app-muted)] mb-1">Name</label>
          <Input v-model="newName" size="sm" placeholder="Role name" @keydown.enter="handleCreate" />
        </div>
        <div>
          <label class="block text-[10px] tracking-[0.08em] uppercase text-[var(--app-muted)] mb-1">Description</label>
          <Input v-model="newDescription" size="sm" placeholder="Optional" @keydown.enter="handleCreate" />
        </div>
        <div class="flex justify-end gap-2">
          <Button variant="ghost" size="sm" label="Cancel" @click="showCreateModal = false" />
          <Button
            size="sm"
            label="Create &amp; set permissions"
            :loading="isCreating"
            :disabled="!newName.trim()"
            @click="handleCreate"
          />
        </div>
      </div>
    </Modal>

    <!-- Roles grid -->
    <div>
      <h4 class="text-[11px] tracking-[0.12em] uppercase font-medium text-[var(--app-muted)] mb-2">Roles</h4>

      <Card v-if="roles.length === 0">
        <Empty
          icon="i-lucide-shield"
          title="No roles defined"
          :description="canManageRoles ? 'Create your first custom role to grant specific permissions to members.' : 'Nothing here yet — an admin can define roles.'"
        >
          <Button v-if="canManageRoles" size="sm" label="Create role" @click="showCreateModal = true">
            <template #leading>
              <Plus class="size-3.5" />
            </template>
          </Button>
        </Empty>
      </Card>

      <div v-else class="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(260px,1fr))]">
        <Card
          v-for="role in roles"
          :key="role.id"
          interactive
          :class="selectedRoleId === role.id ? 'ring-1 ring-[var(--app-accent)]' : ''"
          @click="selectRole(role)"
        >
          <template #header>
            <div class="min-w-0 flex-1">
              <div class="flex items-center gap-2 flex-wrap">
                <h4 class="text-sm tracking-[0.08em] uppercase font-normal text-[var(--app-foreground)] leading-tight after:content-['.'] after:text-[var(--app-accent)]">{{ role.name }}</h4>
                <Badge v-if="role.is_builtin" color="neutral" size="xs">built-in</Badge>
                <Lock v-if="role.name === 'Owner'" class="size-3 text-[var(--app-muted)]" />
              </div>
              <p v-if="role.description" class="text-xs text-[var(--app-muted)] mt-1 line-clamp-2">{{ role.description }}</p>
            </div>
            <div v-if="canEditRole(role) || canDeleteRole(role)" class="flex items-center gap-1 shrink-0" @click.stop>
              <Button
                v-if="canEditRole(role)"
                variant="ghost"
                color="neutral"
                size="xs"
                icon="lucide:pencil"
                title="Edit permissions"
                @click="startEdit(role)"
              />
              <Button
                v-if="canDeleteRole(role)"
                variant="ghost"
                color="error"
                size="xs"
                icon="lucide:trash-2"
                title="Delete role"
                @click="confirmDelete(role.id)"
              />
            </div>
          </template>

          <template #footer>
            <span class="text-[10px] tracking-[0.08em] uppercase text-[var(--app-muted)]">
              <strong class="text-[var(--app-foreground)]">{{ role.permissions.length }}</strong> permissions
            </span>
          </template>
        </Card>
      </div>
    </div>

    <!-- Permissions panel for the selected role -->
    <Card v-if="selectedRole">
      <template #header>
        <div class="flex items-start gap-3 min-w-0 flex-1">
          <Shield class="size-5 text-[var(--app-muted)] mt-0.5 shrink-0" />
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-2 flex-wrap">
              <h4 class="text-sm tracking-[0.08em] uppercase font-normal text-[var(--app-foreground)] leading-tight after:content-['.'] after:text-[var(--app-accent)]">
                {{ isEditMode ? 'Editing' : 'Permissions' }} · {{ selectedRole.name }}
              </h4>
              <Badge v-if="selectedRole.is_builtin" color="neutral" size="xs">built-in</Badge>
              <Badge v-if="isEditMode" color="warning" size="xs">unsaved</Badge>
            </div>
            <p class="text-xs text-[var(--app-muted)] mt-1">
              {{ isEditMode
                ? 'Toggle the permissions this role should grant. Changes apply after Save.'
                : (selectedRole.description || 'No description.') }}
            </p>
          </div>
        </div>
        <div v-if="canEditRole(selectedRole) && !isEditMode" class="shrink-0">
          <Button
            variant="ghost"
            size="xs"
            label="Edit"
            @click="startEdit(selectedRole)"
          >
            <template #leading>
              <Pencil class="size-3.5" />
            </template>
          </Button>
        </div>
      </template>

      <div v-if="isEditMode" class="mb-4">
        <label class="block text-[10px] tracking-[0.08em] uppercase text-[var(--app-muted)] mb-1">Description</label>
        <Input v-model="editDescription" size="sm" placeholder="Optional" />
      </div>

      <div class="space-y-4">
        <div v-for="group in permissionGroups" :key="group.group">
          <div class="text-[11px] tracking-[0.12em] uppercase font-medium text-[var(--app-muted)] mb-2">{{ group.group }}</div>
          <div class="space-y-1">
            <div
              v-for="perm in group.perms"
              :key="perm.id"
              class="flex items-center justify-between py-1.5 border-b border-[var(--app-border)]/50 last:border-0"
            >
              <div class="min-w-0 flex-1 pr-3">
                <div class="text-sm text-[var(--app-foreground)]">{{ perm.label }}</div>
                <div v-if="perm.description" class="text-xs text-[var(--app-muted)] mt-0.5">{{ perm.description }}</div>
              </div>
              <Switch
                v-if="isEditMode"
                :model-value="editPermissions.includes(perm.id)"
                size="sm"
                @update:model-value="togglePermission(perm.id)"
              />
              <Switch
                v-else
                :model-value="selectedRole.permissions.includes(perm.id)"
                size="sm"
                disabled
              />
            </div>
          </div>
        </div>
      </div>

      <template v-if="isEditMode" #footer-end>
        <div class="flex items-center gap-2">
          <Button variant="ghost" size="sm" label="Cancel" @click="cancelEdit" />
          <Button size="sm" label="Save permissions" @click="saveEdit" />
        </div>
      </template>
    </Card>

    <!-- Delete confirmation modal -->
    <div
      v-if="deletingRoleId"
      class="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
      @click.self="deletingRoleId = null"
    >
      <div class="w-full max-w-sm mx-4">
        <Card>
          <template #header>
            <div class="flex items-start gap-3">
              <ShieldAlert class="size-5 text-red-400 mt-0.5 shrink-0" />
              <div class="min-w-0 flex-1">
                <h4 class="text-sm tracking-[0.08em] uppercase font-normal text-red-400 leading-tight after:content-['.']">Delete role</h4>
                <p class="text-xs text-[var(--app-muted)] mt-0.5">
                  Members with this role will be reassigned to <strong class="text-[var(--app-foreground)]">Member</strong>. This action cannot be undone.
                </p>
              </div>
            </div>
          </template>
          <template #footer-end>
            <div class="flex items-center gap-2">
              <Button variant="ghost" size="sm" label="Cancel" @click="deletingRoleId = null" />
              <Button color="error" size="sm" label="Delete role" @click="handleDelete" />
            </div>
          </template>
        </Card>
      </div>
    </div>
  </div>
</template>
