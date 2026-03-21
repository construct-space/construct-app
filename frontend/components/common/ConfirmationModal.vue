<template>
  <Modal v-model:open="isOpen">
    <template #header>
      <div class="flex items-center gap-3">
        <Icon
          :name="iconName"
          :class="iconColorClass"
          class="w-6 h-6"
        />
        <h3 class="text-lg font-semibold text-gray-900 dark:text-gray-100">
          {{ title }}
        </h3>
      </div>
    </template>

    <template #body>
      <div class="space-y-4">
        <p class="text-gray-600 dark:text-gray-400">
          {{ message }}
        </p>

        <div v-if="details" class="bg-gray-50 dark:bg-gray-800 rounded-lg p-3">
          <p class="text-sm text-gray-600 dark:text-gray-400">
            {{ details }}
          </p>
        </div>

        <div v-if="isDestructive" class="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3">
          <div class="flex items-start gap-2">
            <Icon name="i-lucide-alert-triangle" class="w-4 h-4 text-red-600 dark:text-red-400 mt-0.5" />
            <p class="text-sm text-red-700 dark:text-red-300">
              This action cannot be undone. Please proceed with caution.
            </p>
          </div>
        </div>
      </div>
    </template>

    <template #footer>
      <div class="flex flex-row gap-3 items-center justify-start">
        <Button variant="outline" :disabled="loading" @click="handleCancel">
          {{ cancelText }}
        </Button>
        <Button :color="confirmColor" :loading="loading" @click="handleConfirm">
          {{ confirmText }}
        </Button>
      </div>
    </template>
  </Modal>
</template>

<script setup lang="ts">
interface Props {
  modelValue: boolean
  title?: string
  message: string
  details?: string
  confirmText?: string
  cancelText?: string
  confirmColor?: 'primary' | 'error' | 'success' | 'warning' | 'info'
  loading?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  title: 'Confirm Action',
  confirmText: 'Confirm',
  cancelText: 'Cancel',
  confirmColor: 'primary',
  loading: false,
  details: ''
})

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  'confirm': []
  'cancel': []
}>()

const isOpen = computed({
  get: () => props.modelValue,
  set: (value) => emit('update:modelValue', value)
})

const isDestructive = computed(() => props.confirmColor === 'error')

const iconName = computed(() => {
  switch (props.confirmColor) {
    case 'error': return 'i-lucide-alert-triangle'
    case 'success': return 'i-lucide-check-circle'
    case 'warning': return 'i-lucide-alert-circle'
    case 'info': return 'i-lucide-info'
    default: return 'i-lucide-help-circle'
  }
})

const iconColorClass = computed(() => {
  switch (props.confirmColor) {
    case 'error': return 'text-red-600 dark:text-red-400'
    case 'success': return 'text-green-600 dark:text-green-400'
    case 'warning': return 'text-yellow-600 dark:text-yellow-400'
    case 'info': return 'text-blue-600 dark:text-blue-400'
    default: return 'text-gray-600 dark:text-gray-400'
  }
})

const handleConfirm = () => emit('confirm')
const handleCancel = () => {
  emit('cancel')
  isOpen.value = false
}

watch(isOpen, (newValue) => {
  if (!newValue) emit('cancel')
})
</script>
