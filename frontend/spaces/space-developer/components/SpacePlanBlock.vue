<script setup lang="ts">
/**
 * SpacePlanBlock — structured plan card rendered when the agent returns
 * an architect.v1 `plan` envelope during PLAN mode.
 *
 * Shape matches architect.v1 so we can reuse the existing schema + backend
 * (outputSchema: 'architect.v1'). Actions are space-specific: the default
 * "Switch to CODE & build" flips the toolbar mode and replays the plan
 * context as the next prompt.
 */
import { computed } from 'vue'
import { FileText, ArrowRight, CheckCircle2, Boxes } from 'lucide-vue-next'

interface PlanDoc {
  path: string
  title: string
}
interface PlanDecision {
  label: string
  value: string
}
interface PlanAction {
  id: string
  label: string
}

const props = defineProps<{
  title: string
  summary: string
  decisions?: PlanDecision[]
  docs?: PlanDoc[]
  nextActions?: PlanAction[]
}>()

const emit = defineEmits<{
  action: [action: PlanAction]
  'open-doc': [doc: PlanDoc]
}>()

const safeDecisions = computed(() => props.decisions ?? [])
const safeDocs = computed(() => props.docs ?? [])
const safeActions = computed(() => props.nextActions ?? [])

function primaryVariant(a: PlanAction): boolean {
  // "switch-to-code" and "build" are treated as the primary CTA; everything
  // else is a secondary button.
  const id = a.id.toLowerCase()
  return id.includes('code') || id === 'build' || id === 'proceed' || id === 'execute'
}
</script>

<template>
  <div
    class="rounded-lg p-4"
    style="background: var(--app-surface); border: 1px solid var(--app-border)"
  >
    <div class="flex items-center gap-2 mb-3">
      <div
        class="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider"
        style="background: color-mix(in srgb, var(--app-accent) 12%, transparent); color: var(--app-accent); border: 1px solid color-mix(in srgb, var(--app-accent) 30%, transparent)"
      >
        <Boxes :size="10" />
        Plan
      </div>
    </div>

    <h3
      class="text-base font-semibold leading-snug"
      style="color: var(--app-foreground)"
    >
      {{ title }}
    </h3>
    <p
      class="mt-1.5 text-sm leading-relaxed"
      style="color: var(--app-muted)"
    >
      {{ summary }}
    </p>

    <div v-if="safeDecisions.length" class="mt-4 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-[12px]">
      <template v-for="(d, i) in safeDecisions" :key="i">
        <div
          class="font-medium uppercase tracking-wider text-[10px] pt-0.5"
          style="color: var(--app-muted)"
        >
          {{ d.label }}
        </div>
        <div style="color: var(--app-foreground)">{{ d.value }}</div>
      </template>
    </div>

    <div v-if="safeDocs.length" class="mt-4">
      <div
        class="text-[10px] font-semibold uppercase tracking-wider mb-1.5"
        style="color: var(--app-muted)"
      >
        Saved to
      </div>
      <div class="flex flex-col gap-1">
        <button
          v-for="d in safeDocs"
          :key="d.path"
          type="button"
          class="inline-flex items-center gap-2 text-left text-[12px] py-1 px-2 -mx-2 rounded transition hover:bg-[color-mix(in_srgb,var(--app-muted)_8%,transparent)]"
          @click="emit('open-doc', d)"
        >
          <FileText
            :size="12"
            style="color: var(--app-muted); flex-shrink: 0"
          />
          <span style="color: var(--app-accent)" class="truncate">{{ d.path }}</span>
          <span
            v-if="d.title && d.title !== d.path"
            class="truncate"
            style="color: var(--app-muted); opacity: 0.7"
          >
            · {{ d.title }}
          </span>
        </button>
      </div>
    </div>

    <div v-if="safeActions.length" class="mt-4 flex flex-wrap gap-2">
      <button
        v-for="a in safeActions"
        :key="a.id"
        type="button"
        class="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[12px] font-medium transition"
        :style="primaryVariant(a)
          ? 'background: var(--app-accent); color: var(--app-accent-foreground)'
          : 'background: transparent; color: var(--app-foreground); border: 1px solid var(--app-border)'"
        @click="emit('action', a)"
      >
        <CheckCircle2 v-if="primaryVariant(a)" :size="12" />
        <ArrowRight v-else :size="12" />
        {{ a.label }}
      </button>
    </div>
  </div>
</template>
