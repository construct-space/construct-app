<template>
  <div class="selection-pill inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-[var(--app-accent)]/10 border border-[var(--app-accent)]/20">
    <Icon name="i-lucide-check-circle" class="size-4 text-app-accent" />
    <span class="text-sm font-medium text-app">
      {{ phaseLabel }}: <span class="text-app-accent">{{ displayValue }}</span>
    </span>
    <button
      v-if="editable"
      class="p-0.5 rounded-full hover:bg-[var(--app-accent)]/20 transition-colors"
      title="Change selection"
      @click="emit('edit')"
    >
      <Icon name="i-lucide-pencil" class="size-3 text-app-muted" />
    </button>
  </div>
</template>

<script setup lang="ts">
import { INTERVIEW_PHASES, getLabelForValue } from '../../data/architect-knowledge'

interface Props {
  phaseId: string
  value: string | string[]
  editable?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  editable: false
})

const emit = defineEmits<{
  edit: []
}>()

const phaseLabel = computed(() => {
  const phase = INTERVIEW_PHASES.find(p => p.id === props.phaseId)
  return phase?.label || props.phaseId
})

const displayValue = computed(() => {
  if (Array.isArray(props.value)) {
    const labels = props.value.map(v => getLabelForValue(props.phaseId, v))
    if (labels.length > 2) {
      return `${labels.slice(0, 2).join(', ')} +${labels.length - 2} more`
    }
    return labels.join(', ')
  }
  return getLabelForValue(props.phaseId, props.value)
})
</script>
