<script setup lang="ts">
import {
  TabsRoot,
  TabsList,
  TabsTrigger,
  TabsContent,
} from 'reka-ui'

export interface TabItem {
  label: string
  value: string
  icon?: string
}

withDefaults(
  defineProps<{
    modelValue?: string
    items?: TabItem[]
  }>(),
  {
    modelValue: '',
    items: () => [],
  }
)

const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()
</script>

<template>
  <TabsRoot
    :model-value="modelValue"
    @update:model-value="emit('update:modelValue', $event as string)"
  >
    <TabsList
      class="flex border-b border-[var(--app-border)] gap-1"
    >
      <TabsTrigger
        v-for="item in items"
        :key="item.value"
        :value="item.value"
        class="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-[var(--app-muted)] border-b-2 border-transparent -mb-px transition-colors cursor-pointer hover:text-[var(--app-foreground)] data-[state=active]:text-[var(--app-accent)] data-[state=active]:border-[var(--app-accent)]"
      >
        <component
          v-if="item.icon"
          :is="item.icon"
          class="h-4 w-4"
        />
        {{ item.label }}
      </TabsTrigger>
    </TabsList>

    <TabsContent
      v-for="item in items"
      :key="item.value"
      :value="item.value"
      class="mt-3 focus-visible:outline-none"
    >
      <slot :name="item.value" />
    </TabsContent>
  </TabsRoot>
</template>
