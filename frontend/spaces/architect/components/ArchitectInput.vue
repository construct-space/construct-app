<script setup lang="ts">
/**
 * ArchitectInput - Message input area
 */
defineProps<{
  loading: boolean
}>()

const message = defineModel<string>({ default: '' })

const emit = defineEmits<{
  (e: 'send'): void
}>()

const handleKeydown = (e: KeyboardEvent) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    emit('send')
  }
}
</script>

<template>
  <div class="absolute bottom-0 left-0 right-0 p-3 border-t border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
    <div class="max-w-3xl mx-auto flex gap-2">
      <Textarea
        v-model="message"
        placeholder="Describe your project idea..."
        :rows="1"
        autoresize
        class="flex-1"
        @keydown="handleKeydown"
      />
      <Button
        icon="i-lucide-send"
        color="primary"
        size="sm"
        :loading="loading"
        :disabled="!message.trim()"
        @click="emit('send')"
      />
    </div>
  </div>
</template>
