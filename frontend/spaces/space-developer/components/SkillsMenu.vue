<script setup lang="ts">
import { computed, ref, onMounted, onBeforeUnmount } from 'vue'
import { Sparkles, Loader2 } from 'lucide-vue-next'
import type { SkillInfo } from '@/composables/useSkills'

const props = defineProps<{
  skills: SkillInfo[]
  loading: boolean
}>()

const open = ref(false)
const triggerEl = ref<HTMLButtonElement | null>(null)
const popoverEl = ref<HTMLDivElement | null>(null)

const count = computed(() => props.skills.length)

function toggle() { open.value = !open.value }

function close(event: MouseEvent) {
  if (!open.value) return
  const t = event.target as Node
  if (triggerEl.value?.contains(t)) return
  if (popoverEl.value?.contains(t)) return
  open.value = false
}

onMounted(() => {
  document.addEventListener('mousedown', close)
})
onBeforeUnmount(() => {
  document.removeEventListener('mousedown', close)
})
</script>

<template>
  <div class="relative">
    <button
      ref="triggerEl"
      type="button"
      class="inline-flex items-center gap-1.5 text-[11px] font-medium px-2.5 py-1 rounded-full transition"
      style="background: color-mix(in srgb, var(--app-accent) 12%, transparent); color: var(--app-accent); border: 1px solid color-mix(in srgb, var(--app-accent) 30%, transparent)"
      @click="toggle"
    >
      <Loader2 v-if="loading" :size="12" class="animate-spin" />
      <Sparkles v-else :size="12" />
      <span v-if="loading">Loading skills…</span>
      <span v-else>Loaded skills: {{ count }}</span>
    </button>

    <div
      v-if="open && !loading"
      ref="popoverEl"
      class="absolute left-0 top-full mt-1 w-72 rounded-md shadow-lg z-50 p-2 text-sm"
      style="background: var(--app-surface); border: 1px solid var(--app-border); color: var(--app-foreground)"
    >
      <div
        v-if="count === 0"
        class="text-xs italic px-2 py-2"
        style="color: var(--app-muted)"
      >
        No skills loaded for this run yet.
      </div>
      <ul v-else class="space-y-1">
        <li
          v-for="s in skills"
          :key="s.id"
          class="px-2 py-1.5 rounded hover:bg-[color-mix(in_srgb,var(--app-muted)_8%,transparent)]"
        >
          <div
            class="text-[12px] font-medium"
            style="color: var(--app-foreground)"
          >
            {{ s.name || s.id.replace(/^space:/, '') }}
          </div>
          <div
            class="text-[10px] mt-0.5 font-mono truncate"
            style="color: var(--app-muted)"
            :title="s.id"
          >
            {{ s.id }}<span v-if="s.source"> · {{ s.source }}</span>
          </div>
          <div
            v-if="s.description"
            class="text-[11px] mt-0.5"
            style="color: var(--app-muted)"
          >
            {{ s.description }}
          </div>
        </li>
      </ul>
      <div
        class="mt-2 px-2 pt-2 text-[10px] border-t"
        style="border-color: var(--app-border); color: var(--app-muted)"
      >
        Skills appear here when the agent loads them on demand.
      </div>
    </div>
  </div>
</template>
