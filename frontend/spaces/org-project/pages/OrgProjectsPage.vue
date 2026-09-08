<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useOrgProjects, type OrgProject } from '../composables/useOrgProjects'
import { FolderKanban, Plus, Search, Loader2 } from 'lucide-vue-next'
import { Badge, Button, Card, Empty, Input, Modal } from '@construct-space/ui'
import { useOrgPermissions } from '@/spaces/org/composables/useOrgPermissions'
import ToolbarSlot from '@/components/common/ToolbarSlot.vue'

const router = useRouter()
const { projects, loading, error, fetchProjects, createProject } = useOrgProjects()
const { hasPermission } = useOrgPermissions()

// Suppress the intro card when embedded in the Developer Portal — the
// portal renders its own heading and the duplicated "PROJECTS." card
// would just stack on top of itself.
const props = defineProps<{ hideHeader?: boolean }>()

const search = ref('')
const showCreateModal = ref(false)
const isCreating = ref(false)
const canCreateProjects = computed(() => hasPermission('projects.create'))

const filtered = computed(() => {
  let result = projects.value
  if (search.value) {
    const q = search.value.toLowerCase()
    result = result.filter(p =>
      p.name.toLowerCase().includes(q) ||
      p.description?.toLowerCase().includes(q) ||
      p.framework?.toLowerCase().includes(q)
    )
  }
  return result
})

// Create project form
const newName = ref('')
const newDescription = ref('')

async function handleCreate() {
  if (!newName.value.trim()) return
  isCreating.value = true
  try {
    const created = await createProject({
      name: newName.value.trim(),
      description: newDescription.value.trim(),
    })
    if (created) {
      showCreateModal.value = false
      newName.value = ''
      newDescription.value = ''
    }
  } finally {
    isCreating.value = false
  }
}

function openProject(project: OrgProject) {
  router.push(`/app/org-project/${project.id}`)
}

onMounted(() => fetchProjects())
</script>

<template>
  <div class="h-full overflow-auto">
    <ToolbarSlot name="right">
      <Button
        v-if="canCreateProjects"
        size="xs"
        label="New project"
        @click="showCreateModal = true"
      >
        <template #leading>
          <Plus class="size-3.5" />
        </template>
      </Button>
    </ToolbarSlot>
    <div class="max-w-5xl mx-auto px-6 py-6 space-y-4">
      <!-- Intro (full card on standalone page) -->
      <Card v-if="!props.hideHeader" variant="muted">
        <template #header>
          <div class="flex items-start gap-3">
            <FolderKanban class="size-5 text-[var(--app-muted)] mt-0.5 shrink-0" />
            <div class="min-w-0 flex-1">
              <h3 class="text-sm tracking-[0.08em] uppercase font-normal text-[var(--app-foreground)] leading-tight after:content-['.'] after:text-[var(--app-accent)]">Projects</h3>
              <p class="text-sm text-[var(--app-muted)] mt-0.5">Org-wide projects your team is working on.</p>
            </div>
          </div>
        </template>
        <template #accessory>
          <div class="flex items-center gap-2">
            <span class="text-[10px] tracking-[0.08em] uppercase text-[var(--app-muted)]">
              <strong class="text-[var(--app-foreground)]">{{ projects.length }}</strong> total
            </span>
          </div>
        </template>
      </Card>

      <!-- Compact action row (when embedded — keeps the count visible
           without duplicating the parent's heading) -->
      <div v-else class="flex items-center justify-between gap-2">
        <span class="text-[10px] tracking-[0.08em] uppercase text-[var(--app-muted)]">
          <strong class="text-[var(--app-foreground)]">{{ projects.length }}</strong> total
        </span>
      </div>

      <!-- Search -->
      <div class="relative max-w-xs">
        <Search class="size-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--app-muted)] z-10" />
        <Input
          v-model="search"
          placeholder="Search projects…"
          size="sm"
          class="pl-8"
        />
      </div>

      <!-- Loading -->
      <div v-if="loading" class="flex items-center justify-center py-16">
        <Loader2 class="size-5 animate-spin text-[var(--app-muted)]" />
      </div>

      <!-- Error -->
      <Card v-else-if="error">
        <Empty
          icon="i-lucide-triangle-alert"
          title="Could not load projects"
          :description="error"
        >
          <Button size="sm" label="Retry" @click="fetchProjects" />
        </Empty>
      </Card>

      <!-- Empty -->
      <Card v-else-if="filtered.length === 0">
        <Empty
          icon="i-lucide-folder-kanban"
          :title="search ? 'No matches' : 'No projects yet'"
          :description="search ? 'No projects match your search.' : 'Create your first org project to get started.'"
        >
          <Button v-if="canCreateProjects && !search" size="sm" label="New project" @click="showCreateModal = true">
            <template #leading>
              <Plus class="size-3.5" />
            </template>
          </Button>
        </Empty>
      </Card>

      <!-- Project grid -->
      <div v-else class="grid gap-3 grid-cols-2 lg:grid-cols-3">
        <Card
          v-for="project in filtered"
          :key="project.id"
          interactive
          @click="openProject(project)"
        >
          <template #header>
            <div class="flex items-start gap-3">
              <FolderKanban class="size-5 text-[var(--app-muted)] mt-0.5 shrink-0" />
              <div class="min-w-0 flex-1">
                <h4 class="text-sm tracking-[0.08em] uppercase font-normal text-[var(--app-foreground)] leading-tight after:content-['.'] after:text-[var(--app-accent)]">{{ project.name }}</h4>
                <p v-if="project.description" class="text-xs text-[var(--app-muted)] mt-1 line-clamp-2">{{ project.description }}</p>
              </div>
            </div>
          </template>

          <div v-if="project.framework || project.repo_url" class="flex items-center gap-1.5 flex-wrap">
            <Badge v-if="project.framework" color="primary" size="xs">{{ project.framework }}</Badge>
            <Badge v-if="project.repo_url" color="neutral" size="xs">git</Badge>
          </div>
        </Card>
      </div>
    </div>

    <!-- Create modal -->
    <Modal :open="showCreateModal && canCreateProjects" title="New project" @close="showCreateModal = false">
      <div class="space-y-4">
        <p class="text-xs text-[var(--app-muted)]">
          Start with a name and description. You'll wire up repos and members on the project page.
        </p>
        <div>
          <label class="block text-[10px] tracking-[0.08em] uppercase text-[var(--app-muted)] mb-1">Name</label>
          <Input v-model="newName" placeholder="Project name" size="sm" @keydown.enter="handleCreate" />
        </div>
        <div>
          <label class="block text-[10px] tracking-[0.08em] uppercase text-[var(--app-muted)] mb-1">Description</label>
          <Input v-model="newDescription" placeholder="Optional" size="sm" @keydown.enter="handleCreate" />
        </div>
        <div class="flex justify-end gap-2">
          <Button variant="ghost" size="sm" label="Cancel" @click="showCreateModal = false" />
          <Button
            size="sm"
            label="Create project"
            :loading="isCreating"
            :disabled="!newName.trim()"
            @click="handleCreate"
          />
        </div>
      </div>
    </Modal>
  </div>
</template>
