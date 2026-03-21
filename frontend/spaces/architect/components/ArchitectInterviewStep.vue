<script setup lang="ts">
import type { InterviewQuestion } from '../data/architect-knowledge'

const props = defineProps<{
  question: InterviewQuestion
  step: number
  totalSteps: number
  selectedValues: string[]
  showOtherInput: boolean
  otherInputValue: string
}>()

const emit = defineEmits<{
  select: [value: string]
  confirm: []
  confirmOther: []
  back: []
  'update:showOtherInput': [value: boolean]
  'update:otherInputValue': [value: string]
}>()

function isSelected(value: string): boolean {
  return props.selectedValues.includes(value)
}
</script>

<template>
  <div class="space-y-6">
    <!-- Question header -->
    <div class="space-y-2">
      <div class="flex items-center gap-2">
        <span class="text-[11px] text-app-muted/60 uppercase tracking-widest font-medium">{{ question.id }}</span>
        <span class="text-[10px] text-app-muted/40 font-mono">{{ step }}/{{ totalSteps }}</span>
      </div>
      <h2 class="text-xl font-bold text-app tracking-tight leading-snug">{{ question.question }}</h2>
      <p v-if="question.type === 'multi'" class="text-xs text-app-muted">
        Select all that apply, then continue
      </p>
    </div>

    <!-- Options grid -->
    <div class="space-y-1.5">
      <button
        v-for="opt in question.options"
        :key="opt.value"
        class="option-btn w-full flex items-center gap-3 px-3.5 py-3 rounded-lg transition-all duration-150 text-left"
        :class="isSelected(opt.value)
          ? 'bg-app-accent/8 ring-1 ring-app-accent/25'
          : 'hover:bg-white/5'"
        @click="emit('select', opt.value)"
      >
        <div
          class="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 transition-colors"
          :class="isSelected(opt.value) ? 'bg-app-accent/15 text-app-accent' : 'bg-white/8 text-app-muted'"
        >
          <Icon :name="opt.icon || 'i-lucide-box'" class="size-4" />
        </div>
        <div class="flex-1 min-w-0">
          <p class="text-sm font-medium text-app leading-tight">{{ opt.label }}</p>
          <p class="text-xs text-app-muted/70 mt-0.5 leading-snug">{{ opt.description }}</p>
        </div>
        <div
          class="w-5 h-5 rounded-full shrink-0 flex items-center justify-center transition-all"
          :class="isSelected(opt.value) ? 'bg-app-accent' : 'border border-white/12'"
        >
          <Icon v-if="isSelected(opt.value)" name="i-lucide-check" class="size-3 text-white" />
        </div>
      </button>

      <!-- Other option -->
      <button
        v-if="!showOtherInput"
        class="option-btn w-full flex items-center gap-3 px-3.5 py-3 rounded-lg transition-all duration-150 text-left hover:bg-white/5 border border-dashed border-white/8"
        @click="emit('select', '__other__')"
      >
        <div class="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 bg-white/8 text-app-muted">
          <Icon name="i-lucide-pencil" class="size-4" />
        </div>
        <div class="flex-1 min-w-0">
          <p class="text-sm font-medium text-app-muted">Other</p>
          <p class="text-xs text-app-muted/50 mt-0.5">Type your own answer</p>
        </div>
      </button>

      <!-- Other text input -->
      <div v-if="showOtherInput" class="px-3.5 py-3 rounded-lg bg-app-accent/5 ring-1 ring-app-accent/25 space-y-3">
        <div class="flex items-center gap-2">
          <Icon name="i-lucide-pencil" class="size-3.5 text-app-accent shrink-0" />
          <p class="text-xs font-medium text-app">Your answer</p>
        </div>
        <Input
          :model-value="otherInputValue"
          placeholder="Type your choice..."
          autofocus
          @update:model-value="emit('update:otherInputValue', $event as string)"
          @keydown.enter.prevent="emit('confirmOther')"
          @keydown.escape.prevent="emit('update:showOtherInput', false); emit('update:otherInputValue', '')"
        />
        <div class="flex items-center justify-end gap-2">
          <button
            class="text-xs text-app-muted hover:text-app transition-colors"
            @click="emit('update:showOtherInput', false); emit('update:otherInputValue', '')"
          >
            Cancel
          </button>
          <Button size="xs" :disabled="!otherInputValue.trim()" @click="emit('confirmOther')">
            Confirm
          </Button>
        </div>
      </div>
    </div>

    <!-- Navigation -->
    <div class="flex items-center justify-between pt-1">
      <button class="flex items-center gap-1.5 text-xs text-app-muted/60 hover:text-app-muted transition-colors" @click="emit('back')">
        <Icon name="i-lucide-arrow-left" class="size-3" />
        Back
      </button>
      <Button v-if="question.type === 'multi'" size="sm" :disabled="selectedValues.length === 0" @click="emit('confirm')">
        Continue
        <template #trailing>
          <Icon name="i-lucide-arrow-right" class="size-3.5" />
        </template>
      </Button>
    </div>
  </div>
</template>
