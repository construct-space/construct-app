<script setup lang="ts">
/**
 * CurrentUser Widget — 4×2 built-in widget showing user info, date, and quick actions.
 */
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { FolderPlus, FolderOpen, Settings, Store } from 'lucide-vue-next'

const router = useRouter()
const authStore = useAuthStore()

const userName = computed(() => authStore.user?.first_name || 'User')
const userEmail = computed(() => authStore.user?.email || '')
const userInitial = computed(() => userName.value.charAt(0).toUpperCase())

const today = new Date()
const dayNumber = today.getDate().toString().padStart(2, '0')
const dayName = today.toLocaleDateString('en-US', { weekday: 'long' })
const monthYear = today.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })

const openFolder = async () => {
  try {
    const { useProjectDirectory } = await import('@/composables/useProjectDirectory')
    const projectDir = useProjectDirectory()
    const path = await projectDir.openFolderDialog('Open Project Folder')
    if (path) {
      const { useProjectStore } = await import('@/stores/project')
      const projectStore = useProjectStore()
      const added = await projectStore.addExternalFolderByPath(path)
      if (added) {
        const { buildProjectRoutePath } = await import('@/utils/projectRoutes')
        router.push(buildProjectRoutePath(added))
      }
    }
  } catch { /* ignore */ }
}
</script>

<template>
  <div class="h-full flex flex-col p-4 gap-3">
    <!-- User row -->
    <div class="flex items-center gap-3">
      <div
        v-if="authStore.user?.avatar"
        class="size-10 rounded-full bg-cover bg-center border border-[var(--app-border)]"
        :style="{ backgroundImage: `url(${authStore.user.avatar})` }"
      />
      <div
        v-else
        class="size-10 rounded-full bg-[var(--app-accent)] flex items-center justify-center text-white font-bold text-sm"
      >
        {{ userInitial }}
      </div>
      <div class="min-w-0 flex-1">
        <p class="text-sm font-semibold text-[var(--app-foreground)] truncate">{{ userName }}</p>
        <p class="text-[10px] text-[var(--app-muted)] truncate">{{ userEmail }}</p>
      </div>
      <div class="text-right">
        <p class="text-2xl font-bold text-[var(--app-foreground)] leading-none">{{ dayNumber }}</p>
        <p class="text-[10px] text-[var(--app-muted)] uppercase">{{ dayName }}</p>
      </div>
    </div>

    <!-- Quick actions -->
    <div class="flex-1 flex items-end">
      <div class="flex gap-1.5 w-full">
        <button
          class="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-[10px] font-medium text-[var(--app-muted)] hover:text-[var(--app-foreground)] bg-[var(--app-background)] hover:bg-[var(--app-accent)]/10 transition-colors"
          @click="router.push('/app/projects')"
        >
          <FolderPlus class="size-3" />
          New
        </button>
        <button
          class="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-[10px] font-medium text-[var(--app-muted)] hover:text-[var(--app-foreground)] bg-[var(--app-background)] hover:bg-[var(--app-accent)]/10 transition-colors"
          @click="openFolder"
        >
          <FolderOpen class="size-3" />
          Open
        </button>
        <button
          class="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-[10px] font-medium text-[var(--app-muted)] hover:text-[var(--app-foreground)] bg-[var(--app-background)] hover:bg-[var(--app-accent)]/10 transition-colors"
          @click="router.push('/app/marketplace')"
        >
          <Store class="size-3" />
          Market
        </button>
        <button
          class="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-[10px] font-medium text-[var(--app-muted)] hover:text-[var(--app-foreground)] bg-[var(--app-background)] hover:bg-[var(--app-accent)]/10 transition-colors"
          @click="router.push('/app/settings')"
        >
          <Settings class="size-3" />
          Settings
        </button>
      </div>
    </div>
  </div>
</template>
