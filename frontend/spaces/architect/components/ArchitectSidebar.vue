<script setup lang="ts">
/**
 * ArchitectSidebar - Conversation list sidebar
 */
import type { Conversation } from '~/stores/conversations'

defineProps<{
  conversations: Conversation[]
  currentId: string | null
  loading: boolean
}>()

const emit = defineEmits<{
  (e: 'new'): void
  (e: 'select' | 'delete', id: string): void
}>()
</script>

<template>
  <div class="w-64 border-r border-gray-200 dark:border-gray-800 flex flex-col min-h-0">
    <div class="p-3 border-b border-gray-200 dark:border-gray-800">
      <button
        class="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-md border border-gray-200 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors text-sm text-app"
        @click="emit('new')"
      >
        <Icon name="i-lucide-plus" class="size-4" />
        <span>New Session</span>
      </button>
    </div>

    <div class="flex-1 overflow-y-auto">
      <div v-if="loading" class="p-4 flex justify-center">
        <Icon name="i-lucide-loader-2" class="size-4 animate-spin text-app-muted" />
      </div>
      <div v-else-if="conversations.length === 0" class="p-4 text-center text-sm text-app-muted">
        No sessions yet
      </div>
      <div v-else class="p-2 space-y-0.5">
        <div
          v-for="conv in conversations"
          :key="conv.id"
          class="group flex items-center gap-2 px-3 py-2 rounded-md cursor-pointer transition-colors text-sm"
          :class="[
            currentId === conv.id
              ? 'bg-gray-100 dark:bg-gray-800 text-app'
              : 'hover:bg-gray-50 dark:hover:bg-gray-800/50 text-app-muted'
          ]"
          @click="emit('select', conv.id)"
        >
          <Icon name="i-lucide-message-square" class="size-4 shrink-0" />
          <span class="flex-1 truncate">{{ conv.name || 'New Session' }}</span>
          <button
            class="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-700 text-app-muted hover:text-red-500 transition-all"
            @click.stop="emit('delete', conv.id)"
          >
            <Icon name="i-lucide-trash-2" class="size-3" />
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
