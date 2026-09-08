<script setup lang="ts">
import { Button, Card, Modal, Select, Switch } from '@construct-space/ui'
import { Sun, Moon, Monitor, Plus, Palette, Gauge, Sparkles, Bell } from 'lucide-vue-next'
import { useToolbarPrefs } from '@/composables/useToolbarPrefs'
import { useToastPrefs, TOAST_POSITION_OPTIONS, type ToastPosition } from '@/composables/useToastPrefs'
import { useAuthStore } from '@/stores/auth'
import { isOnboardingComplete, markOnboardingComplete, clearOnboarding } from '@/composables/useOnboarding'
import type { AppTheme } from '@/composables/useAppTheme'

const router = useRouter()
const authStore = useAuthStore()
const { allThemes, customTheme, currentThemeId, setTheme, saveCustomTheme, deleteCustomTheme } = useAppTheme()
const { showRuntimeChips } = useToolbarPrefs()
const { toastPosition } = useToastPrefs()

// "Show onboarding on next login" — UI inversion of the stored "complete"
// flag. Toggle ON = clear the flag so /onboarding renders next time the
// route guard runs. Toggle OFF = mark complete so the guard skips it.
// The flag is per-user (keyed by accounts UUID or email).
const currentUserId = computed(() => authStore.user?.id || authStore.user?.email || '')
const showOnboardingNextLogin = ref(false)

watch(currentUserId, async (uid) => {
  if (!uid) return
  const complete = await isOnboardingComplete(uid)
  showOnboardingNextLogin.value = !complete
}, { immediate: true })

async function onShowOnboardingChange(next: boolean) {
  const uid = currentUserId.value
  if (!uid) return
  if (next) {
    await clearOnboarding(uid)
  } else {
    await markOnboardingComplete(uid)
  }
}

async function replayOnboarding() {
  // The route guard redirects authenticated users away from /onboarding
  // when isOnboardingComplete(userId) is true (router/guards.ts), so a
  // naive push() bounces straight back to /app. Clear the flag first.
  const uid = currentUserId.value || 'unknown'
  await clearOnboarding(uid)
  router.push('/onboarding')
}

const isAuto = computed(() => currentThemeId.value === 'auto')

// Theme picker modal — opened from the "Change" button on the OS
// Default Mode card. Keeps the settings page itself uncluttered: users
// who are happy with auto-mode see one card, users who want a specific
// theme drill into the modal grid.
const showThemePicker = ref(false)

const currentThemeName = computed(() => {
  if (isAuto.value) return 'System'
  return allThemes.value.find(t => t.id === currentThemeId.value)?.name ?? 'Custom'
})

// Icon for the active-theme card. When auto is on, show the OS monitor
// glyph; when a specific theme is active, show Sun/Moon for built-ins
// or Palette for the user's custom theme — same convention as the
// picker grid so users can match what they see on the card to the
// entry in the modal.
const currentThemeIcon = computed(() => {
  if (isAuto.value) return Monitor
  if (currentThemeId.value === 'custom') return Palette
  const t = allThemes.value.find(t => t.id === currentThemeId.value)
  return t?.mode === 'light' ? Sun : Moon
})

const currentThemeSubtitle = computed(() => {
  if (isAuto.value) return 'Follow your OS light/dark setting'
  if (currentThemeId.value === 'custom') return 'Custom theme'
  const t = allThemes.value.find(t => t.id === currentThemeId.value)
  return t?.mode === 'light' ? 'Light theme' : 'Dark theme'
})

// Custom theme editor state. The five core fields always have a
// concrete value (defaults backfilled); the four advanced fields start
// empty — empty means "let the derivation heuristic pick for me", a
// concrete hex means "pin this surface to exactly this color".
//
// Using '' for the advanced fields (not undefined) lets v-model on the
// color input behave sensibly — an empty field renders a neutral
// swatch and users can click to pin it from the browser picker.
interface CustomColors {
  background: string
  foreground: string
  muted: string
  accent: string
  accentForeground: string
  canvasBg: string
  border: string
  surface: string
  inputBg: string
}

const showCustomEditor = ref(false)
const customMode = ref<'light' | 'dark'>(customTheme.value?.mode || 'dark')
const customColors = ref<CustomColors>({
  background: customTheme.value?.colors.background || '#1a1a2e',
  foreground: customTheme.value?.colors.foreground || '#e0e0e0',
  muted: customTheme.value?.colors.muted || '#888888',
  accent: customTheme.value?.colors.accent || '#e94560',
  accentForeground: customTheme.value?.colors.accentForeground || '#ffffff',
  canvasBg: customTheme.value?.colors.canvasBg || '',
  border: customTheme.value?.colors.border || '',
  surface: customTheme.value?.colors.surface || '',
  inputBg: customTheme.value?.colors.inputBg || '',
})

// Grouped so the modal can render core vs advanced as separate
// sections. Advanced fields are optional overrides — empty means "let
// applyThemeColors derive it from background".
const coreColorFields = [
  { key: 'background' as const, label: 'Background', hint: 'Main app background' },
  { key: 'foreground' as const, label: 'Text', hint: 'Primary text color' },
  { key: 'muted' as const, label: 'Muted', hint: 'Secondary labels and icons' },
  { key: 'accent' as const, label: 'Accent', hint: 'Selection, links, focus rings' },
  { key: 'accentForeground' as const, label: 'Accent Text', hint: 'Text drawn on accent surfaces' },
]

const advancedColorFields = [
  { key: 'canvasBg' as const, label: 'Canvas', hint: 'Sidebar / dock / outer shell (auto when empty)' },
  { key: 'surface' as const, label: 'Surface', hint: 'Cards, panels, popovers (auto when empty)' },
  { key: 'border' as const, label: 'Border', hint: 'Dividers and outlines (auto when empty)' },
  { key: 'inputBg' as const, label: 'Input', hint: 'Form fields and code blocks (auto when empty)' },
]

function selectTheme(themeId: string) {
  setTheme(themeId)
  // Close the picker after a pick — users who want to experiment can
  // reopen. Leaving it open while the page behind it repaints felt
  // jarring when previewing several themes in a row.
  showThemePicker.value = false
}

function openThemePicker() {
  showThemePicker.value = true
}

function toggleAuto() {
  if (isAuto.value) {
    const isDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches
    setTheme(isDark ? 'vs-dark' : 'vs')
  } else {
    setTheme('auto')
  }
}

function openCustomEditor() {
  if (customTheme.value) {
    customMode.value = customTheme.value.mode
    // Normalise optional advanced fields to '' so the form controls
    // always have a concrete string to bind to. Empty means "auto" in
    // the UI; customColorsForSave strips empties on apply.
    const saved = customTheme.value.colors
    customColors.value = {
      background: saved.background,
      foreground: saved.foreground,
      muted: saved.muted,
      accent: saved.accent,
      accentForeground: saved.accentForeground,
      canvasBg: saved.canvasBg ?? '',
      border: saved.border ?? '',
      surface: saved.surface ?? '',
      inputBg: saved.inputBg ?? '',
    }
  }
  showCustomEditor.value = true
}

function applyCustom() {
  saveCustomTheme(customMode.value, customColorsForSave())
  setTheme('custom')
  showCustomEditor.value = false
}

// Strip empty advanced overrides so `applyThemeColors` falls back to
// the lighten/darken heuristic for any slot the user didn't pin. An
// empty '' would set the CSS var to literal empty-string and leave the
// surface un-styled.
function customColorsForSave(): AppTheme['colors'] {
  const c = customColors.value
  const out: AppTheme['colors'] = {
    background: c.background,
    foreground: c.foreground,
    muted: c.muted,
    accent: c.accent,
    accentForeground: c.accentForeground,
  }
  if (c.canvasBg) out.canvasBg = c.canvasBg
  if (c.border) out.border = c.border
  if (c.surface) out.surface = c.surface
  if (c.inputBg) out.inputBg = c.inputBg
  return out
}

function removeCustom() {
  deleteCustomTheme()
  showCustomEditor.value = false
}

// Live preview while editing
watch([customMode, customColors], () => {
  if (showCustomEditor.value && currentThemeId.value === 'custom') {
    saveCustomTheme(customMode.value, customColorsForSave())
  }
}, { deep: true })
</script>

<template>
  <div class="space-y-6">
    <!-- Active theme card. Title swaps between "OS Default Mode" and
         the picked theme's name so the card doesn't lie about what's
         on. Icon and subtitle follow: Monitor+"Follow OS" when auto,
         Sun/Moon/Palette+mode when a specific theme is active. The
         accessory tracks the same state — auto shows a ✔ selection
         badge, explicit themes show a "Use System Mode" button that
         flips back to auto. Change always opens the picker modal.  -->
    <Card
      interactive
      :class="isAuto ? 'ring-1 ring-[var(--app-accent)]' : ''"
      @click="toggleAuto"
    >
      <template #header>
        <div class="flex items-start gap-3 min-w-0 flex-1">
          <component :is="currentThemeIcon" class="size-5 text-[var(--app-muted)] mt-0.5 shrink-0" />
          <div class="min-w-0 flex-1">
            <h3 class="text-sm tracking-[0.08em] uppercase font-normal text-[var(--app-foreground)] leading-tight after:content-['.'] after:text-[var(--app-accent)]">
              {{ isAuto ? 'OS Default Mode' : currentThemeName }}
            </h3>
            <p class="text-sm text-[var(--app-muted)] mt-0.5">{{ currentThemeSubtitle }}</p>
          </div>
        </div>
        <div class="flex items-center gap-2 shrink-0" @click.stop>
          <div v-if="isAuto" class="size-5 rounded-sm bg-[var(--app-accent)] flex items-center justify-center">
            <svg class="w-3 h-3" viewBox="0 0 10 10" fill="none">
              <path d="M2 5l2.5 2.5L8 3" stroke="var(--app-accent-foreground)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
          </div>
          <Button v-else size="xs" variant="soft" label="Use System Mode" @click="toggleAuto" />
          <Button size="xs" variant="soft" label="Change" @click="openThemePicker" />
        </div>
      </template>
    </Card>

    <!-- Runtime toolbar chips toggle -->
    <Card
      interactive
      :class="showRuntimeChips ? 'ring-1 ring-[var(--app-accent)]' : ''"
      @click="showRuntimeChips = !showRuntimeChips"
    >
      <template #header>
        <div class="flex items-start gap-3 min-w-0 flex-1">
          <Gauge class="size-5 text-[var(--app-muted)] mt-0.5 shrink-0" />
          <div class="min-w-0 flex-1">
            <h3 class="text-sm tracking-[0.08em] uppercase font-normal text-[var(--app-foreground)] leading-tight after:content-['.'] after:text-[var(--app-accent)]">Runtime chips</h3>
            <p class="text-sm text-[var(--app-muted)] mt-0.5">Show context % and session cost in the toolbar</p>
          </div>
        </div>
        <div class="shrink-0" @click.stop>
          <Switch v-model="showRuntimeChips" />
        </div>
      </template>
    </Card>

    <!-- Toast position — where transient notifications anchor on screen.
         Applies to every toast (host + space-emitted) since they share a
         single render surface. -->
    <Card>
      <template #header>
        <div class="flex items-start gap-3 min-w-0 flex-1">
          <Bell class="size-5 text-[var(--app-muted)] mt-0.5 shrink-0" />
          <div class="min-w-0 flex-1">
            <h3 class="text-sm tracking-[0.08em] uppercase font-normal text-[var(--app-foreground)] leading-tight after:content-['.'] after:text-[var(--app-accent)]">Notifications</h3>
            <p class="text-sm text-[var(--app-muted)] mt-0.5">Which corner toast notifications appear in</p>
          </div>
        </div>
        <div class="shrink-0 w-44" @click.stop>
          <Select
            :model-value="toastPosition"
            :options="TOAST_POSITION_OPTIONS"
            :placeholder="''"
            @update:model-value="toastPosition = (Array.isArray($event) ? $event[0] : $event) as ToastPosition"
          />
        </div>
      </template>
    </Card>

    <!-- Onboarding replay — toggle the welcome flow back on for the
         next login, or jump into it right now. The toggle inverts the
         per-user onboarding-complete flag; the link is a one-tap
         shortcut that routes straight to /onboarding without affecting
         the flag (the page itself will mark complete when finished). -->
    <Card>
      <template #header>
        <div class="flex items-start gap-3 min-w-0 flex-1">
          <Sparkles class="size-5 text-[var(--app-muted)] mt-0.5 shrink-0" />
          <div class="min-w-0 flex-1">
            <h3 class="text-sm tracking-[0.08em] uppercase font-normal text-[var(--app-foreground)] leading-tight after:content-['.'] after:text-[var(--app-accent)]">Onboarding</h3>
            <p class="text-sm text-[var(--app-muted)] mt-0.5">
              Show the welcome flow on next login, or replay it now.
            </p>
          </div>
        </div>
        <div class="flex items-center gap-2 shrink-0" @click.stop>
          <Button size="xs" variant="soft" label="Replay now" @click="replayOnboarding" />
          <Switch
            v-model="showOnboardingNextLogin"
            @update:model-value="onShowOnboardingChange"
          />
        </div>
      </template>
    </Card>

    <!-- Theme picker modal — opened from the Change button above.
         Cards are laid out in a 4-column grid (down from the previous
         3-col inline grid) to fit the modal width without crowding the
         color previews. -->
    <Modal v-model:open="showThemePicker" title="Choose theme">
      <div class="grid grid-cols-4 gap-2">
        <button
          v-for="theme in allThemes"
          :key="theme.id"
          class="relative rounded-sm border overflow-hidden transition-all text-left focus:outline-none cursor-pointer"
          :class="!isAuto && currentThemeId === theme.id
            ? 'border-[var(--app-accent)] ring-1 ring-[var(--app-accent)]'
            : 'border-[var(--app-border)] hover:border-[var(--app-muted)]'"
          @click="theme.id === 'custom' ? openCustomEditor() : selectTheme(theme.id)"
        >
          <!-- Color preview -->
          <div
            class="h-12 w-full relative"
            :style="{ backgroundColor: theme.colors.background }"
          >
            <div
              class="absolute bottom-0 left-0 right-0 h-0.5"
              :style="{ backgroundColor: theme.colors.accent }"
            />
            <div class="p-1.5 flex flex-col gap-0.5">
              <div class="h-1 rounded-sm w-3/4" :style="{ backgroundColor: theme.colors.foreground, opacity: 0.7 }" />
              <div class="h-1 rounded-sm w-1/2" :style="{ backgroundColor: theme.colors.muted, opacity: 0.5 }" />
              <div class="mt-0.5 h-2 rounded-sm w-8" :style="{ backgroundColor: theme.colors.accent }" />
            </div>
          </div>

          <div class="px-1.5 py-1 flex items-center justify-between gap-1" :style="{ backgroundColor: theme.colors.background }">
            <span class="text-[10px] tracking-[0.06em] uppercase font-normal truncate" :style="{ color: theme.colors.foreground }">{{ theme.name }}</span>
            <component
              :is="theme.id === 'custom' ? Palette : theme.mode === 'light' ? Sun : Moon"
              class="size-2.5 shrink-0"
              :style="{ color: theme.colors.muted }"
            />
          </div>

          <!-- Selected indicator -->
          <div
            v-if="!isAuto && currentThemeId === theme.id"
            class="absolute top-1 right-1 w-3.5 h-3.5 rounded-sm flex items-center justify-center"
            :style="{ backgroundColor: theme.colors.accent }"
          >
            <svg class="size-2" viewBox="0 0 10 10" fill="none">
              <path d="M2 5l2.5 2.5L8 3" :stroke="theme.colors.accentForeground" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
          </div>
        </button>

        <!-- Create custom theme button -->
        <button
          v-if="!customTheme"
          class="rounded-sm border border-dashed border-[var(--app-border)] hover:border-[var(--app-muted)] overflow-hidden transition-all focus:outline-none flex flex-col items-center justify-center gap-1 min-h-[4.5rem] cursor-pointer"
          @click="openCustomEditor"
        >
          <Plus class="size-4 text-[var(--app-muted)]" />
          <span class="text-[10px] tracking-[0.06em] uppercase font-normal text-[var(--app-muted)]">Custom</span>
        </button>
      </div>

      <template #footer>
        <div class="flex justify-between items-center">
          <span class="text-xs text-[var(--app-muted)]">
            {{ isAuto ? 'Currently following OS setting' : `Currently: ${currentThemeName}` }}
          </span>
          <Button variant="ghost" color="neutral" label="Done" @click="showThemePicker = false" />
        </div>
      </template>
    </Modal>

    <!-- Custom theme editor modal -->
    <Modal v-model:open="showCustomEditor" title="Custom Theme">
      <template v-if="customTheme" #accessory>
        <Button variant="ghost" color="error" size="xs" icon="lucide:trash-2" label="Delete" @click="removeCustom" />
      </template>

      <div class="space-y-5">
        <!-- Live preview -->
        <div
          class="rounded-sm overflow-hidden border border-[var(--app-border)]"
          :style="{ backgroundColor: customColors.background }"
        >
          <div class="p-3 flex flex-col gap-1.5">
            <div class="h-2 rounded-sm w-3/4" :style="{ backgroundColor: customColors.foreground, opacity: 0.7 }" />
            <div class="h-2 rounded-sm w-1/2" :style="{ backgroundColor: customColors.muted, opacity: 0.5 }" />
            <div class="mt-2 flex gap-2">
              <div class="h-6 rounded-sm px-3 flex items-center" :style="{ backgroundColor: customColors.accent }">
                <span class="text-[10px] tracking-[0.08em] uppercase font-normal" :style="{ color: customColors.accentForeground }">Button</span>
              </div>
              <div class="h-6 rounded-sm px-3 flex items-center border" :style="{ borderColor: customColors.muted }">
                <span class="text-[10px] tracking-[0.08em] uppercase font-normal" :style="{ color: customColors.foreground }">Secondary</span>
              </div>
            </div>
          </div>
          <div class="h-1" :style="{ backgroundColor: customColors.accent }" />
        </div>

        <!-- Core color pickers — every theme must set these. -->
        <div class="space-y-3">
          <div class="text-[10px] tracking-[0.1em] uppercase text-[var(--app-muted)] font-medium">Core</div>
          <div
            v-for="field in coreColorFields"
            :key="field.key"
            class="flex items-start gap-3"
          >
            <div class="w-24 shrink-0 pt-1.5">
              <div class="text-[11px] tracking-[0.08em] uppercase text-[var(--app-foreground)]">{{ field.label }}</div>
              <div class="text-[10px] text-[var(--app-muted)] mt-0.5 leading-snug">{{ field.hint }}</div>
            </div>
            <div class="flex items-center gap-2 flex-1">
              <label class="relative size-8 rounded-sm border border-[var(--app-border)] overflow-hidden cursor-pointer shrink-0">
                <input
                  type="color"
                  v-model="customColors[field.key]"
                  class="absolute inset-0 opacity-0 cursor-pointer"
                />
                <div class="w-full h-full" :style="{ backgroundColor: customColors[field.key] }" />
              </label>
              <input
                type="text"
                v-model="customColors[field.key]"
                class="flex-1 text-xs font-mono px-2 py-1.5 rounded-sm bg-transparent border border-[var(--app-border)] text-[var(--app-foreground)] focus:outline-none focus:border-[var(--app-accent)]"
                maxlength="7"
                placeholder="#000000"
              />
            </div>
          </div>
        </div>

        <!-- Advanced overrides — leave blank to let the app derive
             them from Background using a lighten/darken heuristic.
             Exposed so users with a specific brand palette can pin
             each surface exactly instead of accepting the derivation. -->
        <div class="space-y-3 pt-4 border-t border-[var(--app-border)]/40">
          <div class="flex items-baseline justify-between">
            <div class="text-[10px] tracking-[0.1em] uppercase text-[var(--app-muted)] font-medium">Advanced surfaces</div>
            <div class="text-[10px] text-[var(--app-muted)]/70">Leave blank to auto-derive</div>
          </div>
          <div
            v-for="field in advancedColorFields"
            :key="field.key"
            class="flex items-start gap-3"
          >
            <div class="w-24 shrink-0 pt-1.5">
              <div class="text-[11px] tracking-[0.08em] uppercase text-[var(--app-foreground)]">{{ field.label }}</div>
              <div class="text-[10px] text-[var(--app-muted)] mt-0.5 leading-snug">{{ field.hint }}</div>
            </div>
            <div class="flex items-center gap-2 flex-1">
              <label class="relative size-8 rounded-sm border border-[var(--app-border)] overflow-hidden cursor-pointer shrink-0">
                <input
                  type="color"
                  v-model="customColors[field.key]"
                  class="absolute inset-0 opacity-0 cursor-pointer"
                />
                <div
                  class="w-full h-full"
                  :style="customColors[field.key]
                    ? { backgroundColor: customColors[field.key] }
                    : { background: 'repeating-linear-gradient(45deg, transparent, transparent 3px, var(--app-border) 3px, var(--app-border) 4px)' }"
                />
              </label>
              <input
                type="text"
                v-model="customColors[field.key]"
                class="flex-1 text-xs font-mono px-2 py-1.5 rounded-sm bg-transparent border border-[var(--app-border)] text-[var(--app-foreground)] focus:outline-none focus:border-[var(--app-accent)]"
                maxlength="7"
                placeholder="auto"
              />
              <button
                v-if="customColors[field.key]"
                class="text-[10px] tracking-[0.06em] uppercase text-[var(--app-muted)] hover:text-[var(--app-foreground)] px-2 py-1"
                @click="customColors[field.key] = ''"
              >
Clear
</button>
            </div>
          </div>
        </div>
      </div>

      <template #footer>
        <div class="flex justify-end gap-2">
          <Button variant="ghost" color="neutral" label="Cancel" @click="showCustomEditor = false" />
          <Button variant="solid" color="primary" label="Apply Theme" @click="applyCustom" />
        </div>
      </template>
    </Modal>
  </div>
</template>
