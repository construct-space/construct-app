<script setup lang="ts">
import { computed } from 'vue'
import { useAuthStore } from '@/stores/auth'
import { Calendar, CheckSquare, Zap, FolderPlus } from 'lucide-vue-next'

const authStore = useAuthStore()

const userName = computed(() => authStore.user?.first_name || 'User')

const today = new Date()
const dayNumber = today.getDate().toString().padStart(2, '0')
const monthYear = today.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }).toUpperCase()
</script>

<template>
  <div class="h-screen overflow-hidden flex items-center justify-center px-6">
    <div class="w-full max-w-3xl space-y-8">
      <div>
        <p class="text-sm text-app-muted tracking-wider">WELCOME BACK,</p>
        <h1 class="text-5xl font-bold text-app mt-1">{{ userName }}</h1>
      </div>
      <div class="flex items-start gap-4">
        <div>
          <p class="text-6xl font-bold text-app">{{ dayNumber }}</p>
          <p class="text-sm text-app-muted uppercase tracking-wider">{{ monthYear }}</p>
        </div>
        <div class="flex-1">
          <div class="flex items-center gap-2 mb-2">
            <Calendar class="size-4 text-app-muted" />
            <span class="text-sm text-app-muted uppercase tracking-wider">My Calendar</span>
          </div>
          <p class="text-sm text-app-muted">No events today</p>
        </div>
      </div>
      <div class="space-y-3">
        <div class="flex items-center gap-2">
          <CheckSquare class="size-4 text-app-muted" />
          <span class="text-sm text-app-muted uppercase tracking-wider">My Todos</span>
        </div>
        <p class="text-sm text-app-muted">No tasks assigned to you</p>
      </div>
      <div class="pt-4 border-t border-app-muted/20">
        <div class="flex items-center gap-2 mb-3">
          <Zap class="size-4 text-app-muted" />
          <span class="text-sm text-app-muted uppercase tracking-wider">Quick Actions</span>
        </div>
        <div class="flex flex-wrap gap-3">
          <RouterLink to="/app/code" class="flex items-center gap-2 px-3 py-2 rounded-md bg-white/50 dark:bg-white/10 text-app hover:bg-app-accent hover:text-app-accent-foreground transition-colors text-sm">
            <FolderPlus class="size-4" />
            <span class="font-medium">NEW PROJECT</span>
          </RouterLink>
        </div>
      </div>
    </div>
  </div>
</template>
