<script setup lang="ts">
import type { ActionBlock } from '@/assistant'

defineProps<{
  block: ActionBlock
}>()

const emit = defineEmits<{
  action: [action: ActionBlock['actions'][number]]
}>()
</script>

<template>
  <div class="my-2 flex flex-wrap gap-2">
    <button
      v-for="act in block.actions"
      :key="act.id"
      :disabled="act.disabled"
      :title="act.description"
      class="rounded-lg px-3 py-1.5 text-xs font-medium transition disabled:opacity-40 text-left"
      :class="{
        'bg-app-accent text-black hover:bg-app-accent/80': act.variant === 'primary',
        'border border-app-border text-app hover:bg-white/5': !act.variant || act.variant === 'secondary',
        'bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20': act.variant === 'danger',
      }"
      @click="emit('action', act)"
    >
      <Icon v-if="act.icon" :name="act.icon" class="size-3 inline mr-1" />
      <span>{{ act.label }}</span>
      <span v-if="act.description" class="ml-1.5 text-app-muted font-normal">— {{ act.description }}</span>
    </button>
  </div>
</template>
