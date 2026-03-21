<script setup lang="ts">
import { useSkills } from '@/composables/useSkills'
import type { SkillInfo, HookInfo } from '@/composables/useSkills'
import Switch from '@/components/ui/Switch.vue'
import Select from '@/components/ui/Select.vue'
import Button from '@/components/ui/Button.vue'

const toast = useToast()
const { skills, hooks, isLoading, loadSkill, enableSkill, disableSkill, enableHook, disableHook, loadBuiltins, refresh } = useSkills()

const activeTab = ref<'skills' | 'hooks'>('skills')
const selectedSkill = ref<SkillInfo | null>(null)
const hookTypeFilter = ref('')

const hookTypes = [
  { label: 'All Types', value: '' },
  { label: 'Session', value: 'session' },
  { label: 'Tool', value: 'tool' },
  { label: 'Agent', value: 'agent' },
  { label: 'Context', value: 'context' },
]

const filteredHooks = computed(() => {
  if (!hookTypeFilter.value) return hooks.value
  return hooks.value.filter(h => h.type.startsWith(hookTypeFilter.value))
})

const stateColors: Record<string, string> = {
  active: 'bg-green-500/10 text-green-500',
  disabled: 'bg-amber-500/10 text-amber-500',
  error: 'bg-red-500/10 text-red-500',
  loading: 'bg-blue-500/10 text-blue-500',
  unloaded: 'bg-[color-mix(in_srgb,var(--app-muted)_15%,transparent)] text-[var(--app-muted)]',
}

async function toggleSkill(skill: SkillInfo) {
  try {
    if (skill.state === 'active') {
      await disableSkill(skill.id)
      toast.add({ title: `${skill.name} disabled`, color: 'warning' })
    } else if (skill.state === 'disabled' || skill.state === 'unloaded') {
      if (skill.state === 'unloaded') await loadSkill(skill.id)
      await enableSkill(skill.id)
      toast.add({ title: `${skill.name} enabled`, color: 'success' })
    }
  } catch (e) {
    toast.add({ title: String(e), color: 'error' })
  }
}

async function toggleHook(hook: HookInfo) {
  try {
    if (hook.enabled) {
      await disableHook(hook.id)
      toast.add({ title: `${hook.name} disabled`, color: 'warning' })
    } else {
      await enableHook(hook.id)
      toast.add({ title: `${hook.name} enabled`, color: 'success' })
    }
  } catch (e) {
    toast.add({ title: String(e), color: 'error' })
  }
}

async function handleLoadBuiltins() {
  try {
    const success = await loadBuiltins()
    if (success) {
      await new Promise(resolve => setTimeout(resolve, 500))
      await refresh()
      toast.add({ title: 'Built-in skills loaded', color: 'success' })
    } else {
      toast.add({ title: 'Could not load skills', color: 'warning' })
    }
  } catch {
    toast.add({ title: 'Connection lost - please restart the app', color: 'error' })
  }
}

onMounted(() => { refresh() })
</script>

<template>
  <div>
    <div class="flex items-center justify-between mb-1">
      <div class="flex gap-2">
        <Button variant="soft" size="sm" :loading="isLoading" label="Refresh" @click="refresh" />
        <Button size="sm" label="Load Builtins" @click="handleLoadBuiltins" />
      </div>
    </div>

    <!-- Tabs -->
    <div class="flex gap-1 p-1 bg-[color-mix(in_srgb,var(--app-muted)_8%,transparent)] rounded-lg w-fit mb-6">
      <button
        class="px-4 py-1.5 text-sm rounded-md transition-colors cursor-pointer"
        :class="activeTab === 'skills' ? 'bg-app-accent text-white' : 'text-[var(--app-muted)] hover:text-[var(--app-foreground)]'"
        @click="activeTab = 'skills'"
      >
        Skills ({{ skills.length }})
      </button>
      <button
        class="px-4 py-1.5 text-sm rounded-md transition-colors cursor-pointer"
        :class="activeTab === 'hooks' ? 'bg-app-accent text-white' : 'text-[var(--app-muted)] hover:text-[var(--app-foreground)]'"
        @click="activeTab = 'hooks'"
      >
        Hooks ({{ hooks.length }})
      </button>
    </div>

    <!-- Loading -->
    <div v-if="isLoading" class="flex items-center justify-center py-12">
      <svg class="w-6 h-6 animate-spin text-[var(--app-muted)]" viewBox="0 0 24 24" fill="none">
        <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
        <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
      </svg>
    </div>

    <!-- Skills Tab -->
    <template v-else-if="activeTab === 'skills'">
      <div v-if="skills.length === 0" class="text-center py-12 text-[var(--app-muted)]">
        <p class="text-sm mb-3">No skills loaded</p>
        <Button label="Load Built-in Skills" @click="handleLoadBuiltins" />
      </div>

      <div v-else class="space-y-3">
        <div
          v-for="skill in skills"
          :key="skill.id"
          class="p-4 rounded-lg border transition-colors cursor-pointer"
          :class="skill.state === 'active' ? 'border-[var(--app-border)]' : 'border-[var(--app-border)] opacity-60'"
          @click="selectedSkill = selectedSkill?.id === skill.id ? null : skill"
        >
          <div class="flex items-start justify-between mb-2">
            <div>
              <div class="flex items-center gap-2">
                <h4 class="text-sm font-medium text-[var(--app-foreground)]">{{ skill.name }}</h4>
                <span class="text-[10px] text-[var(--app-muted)]">v{{ skill.version }}</span>
                <span :class="['px-1.5 py-0.5 text-[10px] rounded-full', stateColors[skill.state] || stateColors.unloaded]">
                  {{ skill.state }}
                </span>
              </div>
              <p class="text-xs text-[var(--app-muted)] mt-0.5 line-clamp-2">{{ skill.description }}</p>
            </div>
            <Switch
              :model-value="skill.state === 'active'"
              size="sm"
              @click.stop
              @update:model-value="toggleSkill(skill)"
            />
          </div>

          <div class="flex items-center gap-3 text-xs text-[var(--app-muted)]">
            <span>{{ skill.hooksCount }} hooks</span>
            <span>{{ skill.toolsCount }} tools</span>
            <span class="capitalize">{{ skill.category }}</span>
          </div>

          <!-- Detail panel -->
          <div v-if="selectedSkill?.id === skill.id" class="mt-3 pt-3 border-t border-[var(--app-border)]">
            <div class="grid grid-cols-2 gap-3 text-xs">
              <div><span class="text-[var(--app-muted)]">Category:</span> <span class="text-[var(--app-foreground)]">{{ skill.category }}</span></div>
              <div><span class="text-[var(--app-muted)]">Hooks:</span> <span class="text-[var(--app-foreground)]">{{ skill.hooksCount }}</span></div>
              <div><span class="text-[var(--app-muted)]">Tools:</span> <span class="text-[var(--app-foreground)]">{{ skill.toolsCount }}</span></div>
              <div v-if="skill.dependencies?.length"><span class="text-[var(--app-muted)]">Deps:</span> <span class="text-[var(--app-foreground)]">{{ skill.dependencies.join(', ') }}</span></div>
            </div>
          </div>
        </div>
      </div>
    </template>

    <!-- Hooks Tab -->
    <template v-else-if="activeTab === 'hooks'">
      <div class="flex items-center gap-3 mb-4">
        <Select v-model="hookTypeFilter" :options="hookTypes" placeholder="Filter by type" />
        <span class="text-xs text-[var(--app-muted)]">{{ filteredHooks.length }} hooks</span>
      </div>

      <div v-if="hooks.length === 0" class="text-center py-12 text-[var(--app-muted)]">
        <p class="text-sm">No hooks registered. Load skills to register their hooks.</p>
      </div>

      <div v-else class="space-y-2">
        <div
          v-for="hook in filteredHooks"
          :key="hook.id"
          class="p-3 rounded-lg border flex items-center justify-between"
          :class="hook.enabled ? 'border-[var(--app-border)]' : 'border-[var(--app-border)] opacity-60'"
        >
          <div>
            <div class="flex items-center gap-2">
              <h4 class="text-sm font-medium text-[var(--app-foreground)]">{{ hook.name }}</h4>
              <span class="px-1.5 py-0.5 text-[10px] rounded-full bg-[color-mix(in_srgb,var(--app-muted)_15%,transparent)] text-[var(--app-muted)]">
                {{ hook.type }}
              </span>
            </div>
            <p class="text-xs text-[var(--app-muted)]">
              {{ hook.description || hook.id }}
              <span v-if="hook.skillId"> &middot; from {{ hook.skillId }}</span>
            </p>
          </div>
          <div class="flex items-center gap-3">
            <span class="text-xs text-[var(--app-muted)]">Priority: {{ hook.priority }}</span>
            <Switch :model-value="hook.enabled" size="sm" @update:model-value="toggleHook(hook)" />
          </div>
        </div>
      </div>
    </template>
  </div>
</template>
