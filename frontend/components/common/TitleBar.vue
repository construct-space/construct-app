<script setup lang="ts">
/**
 * TitleBar — top-of-window strip, full width.
 *
 * Layout:
 *   ┌──────────────────────────────────────────────┐
 *   │ ●●●   (drag region — moves the window)   [↗] │
 *   └──────────────────────────────────────────────┘
 *
 * - 32px tall — matches Tauri-decorum's stock title bar height
 * - Left padding clears the macOS traffic-light cluster (~76px)
 * - data-tauri-drag-region makes the whole row a drag handle
 * - Detach button (right side) pops the current space into its own window
 */
import { ref, computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ExternalLink, Sparkles, ChevronLeft } from 'lucide-vue-next'
import { useToolbar } from '@/composables/useToolbar'
import { useSpaceRunner } from '@/composables/useSpaceRunner'
import { useProjectStore } from '@/stores/project'
import { useAIModel } from '@/composables/useAIModel'
import { useConstructCredits } from '@/composables/useConstructCredits'
import { getWindowLabel, isSpacePopoutLabel } from '@/lib/window/windowType'
import NowPlaying from '@/components/common/NowPlaying.vue'
import PresenceStatus from '@/components/common/PresenceStatus.vue'
import WindowControls from '@/components/common/WindowControls.vue'
import { usePlatform } from '@/composables/usePlatform'
// Tooltip is globally auto-registered (unplugin-vue-components)

const { isMac, usesCustomChrome } = usePlatform()

// Double-click the title bar to maximize/restore — standard on Windows/Linux,
// where the frame is custom. macOS's native overlay title bar handles this
// itself, so we skip it there.
async function onTitleBarDblClick() {
  if (!usesCustomChrome()) return
  try {
    const { getCurrentWindow } = await import('@tauri-apps/api/window')
    await getCurrentWindow().toggleMaximize()
  } catch { /* not in Tauri */ }
}

const route = useRoute()
const router = useRouter()
const { visiblePanel } = useToolbar()
const { openRunner } = useSpaceRunner()
const projectStore = useProjectStore()

// Ask lives on the left of the title bar (moved out of the sidebar). Hidden in
// space popout windows, which carry their own single-space chrome.
const isAskActive = computed(() => route.path.startsWith('/app/ask'))

// Back — plain history-back, mirrors the browser/devtools "Back" affordance.
function goBack() {
  router.back()
}

// Construct gateway credits — title-bar chip. Only shown when the
// active model is the Construct picker entry; BYOK providers don't
// have a credit counter so the chip is hidden in that case.
const aiModel = useAIModel()
const credits = useConstructCredits()
const isOnConstruct = computed(() => {
  const id = aiModel.defaultModelId.value || ''
  return id.startsWith('construct:') || id === 'source'
})
const creditsLow = computed(() =>
  credits.allowance.value > 0 && credits.used.value >= credits.allowance.value * 0.8,
)
onMounted(() => { void credits.fetchConstructCredits() })

// Hide detach when we're already in a detached/popout window — a label of
// 'main-<spaceId>' means this IS the popout for that space, so re-detaching
// is meaningless. Matches the same gating Toolbar3D used previously.
const isPopoutWindow = ref(false)
onMounted(async () => {
  const label = await getWindowLabel()
  // An extra Construct window (main-<timestamp>) is NOT a popout — only real
  // space popouts (main-<spaceId>) are. isSpacePopoutLabel excludes the
  // numeric-suffix case so detach stays available in extra windows.
  isPopoutWindow.value = isSpacePopoutLabel(label)
})

const canDetach = computed(() => !!visiblePanel.value?.spaceName && !isPopoutWindow.value)

function detachSpace() {
  const spaceName = visiblePanel.value?.spaceName
  if (!spaceName) return
  const project = projectStore.currentProject
  const projectPath = project?.local_path || project?.path
  openRunner({
    spaceId: spaceName,
    project: projectPath || undefined,
    projectId: project?.id !== undefined ? project.id : undefined,
  })
}
</script>

<template>
  <!-- A real flex row, all in normal flow:
         | traffic-light spacer | drag region (flex-1) | detach |
       No fixed positioning, no z-index. Requires decorum's
       create_overlay_titlebar() to be removed in lib.rs so this row's
       data-tauri-drag-region is the only drag handle. -->
  <div class="title-bar h-8 shrink-0 flex items-stretch select-none" @contextmenu.prevent>
    <!-- Reserve room for the macOS traffic lights cluster. Not a drag
         region because the OS renders the buttons here. macOS only — on
         Windows/Linux the window is frameless and there are no traffic lights. -->
    <div v-if="isMac()" class="title-bar__traffic shrink-0" />

    <!-- Back + Ask — left-side actions (moved here from the sidebar). Outside
         the drag region so clicks reach them. Hidden in space popout windows. -->
    <div v-if="!isPopoutWindow" class="flex items-center pl-1 gap-1">
      <button class="title-bar__back" title="Back" @click="goBack">
        <ChevronLeft class="size-4" />
        <span>Back</span>
      </button>
      <Tooltip text="Ask">
        <RouterLink to="/app/ask" class="title-bar__ask" :class="{ 'title-bar__ask--active': isAskActive }"
          data-tour="titlebar-ask">
          <Sparkles class="size-4" />
        </RouterLink>
      </Tooltip>
    </div>

    <!-- Drag handle — everything between the traffic lights and the
         action buttons is a window-drag area. The now-playing mini-player
         floats centered here (no-drag); the surrounding area stays draggable.
         Renders nothing when no media is playing. -->
    <div data-tauri-drag-region class="flex-1 h-full flex items-center justify-center min-w-0"
      @dblclick="onTitleBarDblClick">
      <NowPlaying />
    </div>

    <!-- Detach (and any future title-bar actions) live here, OUTSIDE the
         drag region. Tauri ignores no-drag clicks → button receives them. -->
    <div class="title-bar__actions flex items-center pr-2 gap-1">
      <PresenceStatus />
      <Tooltip
        v-if="isOnConstruct && credits.loaded.value && credits.allowance.value > 0"
        :text="`Construct credits: ${credits.used.value} of ${credits.allowance.value} used${credits.paidBalance.value > 0 ? ` · ${credits.paidBalance.value} paid balance` : ''}`"
      >
        <div
          class="title-bar__credits flex items-center gap-1 px-2 h-6 text-[11px] font-mono tabular-nums rounded-md"
          :class="creditsLow ? 'text-amber-600 bg-amber-500/15' : 'text-app-muted bg-app-input-bg/50'"
        >
          <span class="opacity-70">CREDITS:</span>
          <span>{{ credits.used.value }} / {{ credits.allowance.value }}</span>
        </div>
      </Tooltip>
      <Tooltip v-if="canDetach" text="Open in separate window">
        <button class="title-bar__btn" @click="detachSpace">
          <ExternalLink class="size-3.5" />
        </button>
      </Tooltip>
    </div>

    <!-- Window controls (min/max/close) — Windows/Linux only, flush to the
         top-right corner after the presence/actions. macOS uses native traffic
         lights on the left. WindowControls hides itself on macOS. -->
    <WindowControls />
  </div>
</template>

<style scoped>
.title-bar {
  background: transparent;
}

.title-bar__traffic {
  /* macOS traffic-light cluster lives in roughly this region (set
     by set_traffic_lights_inset in lib.rs). Reserve the width so our
     drag area starts to the right of it. */
  width: 76px;
}

.title-bar__btn {
  -webkit-app-region: no-drag;
  app-region: no-drag;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 24px;
  border-radius: 0.375rem;
  border: none;
  background: transparent;
  color: var(--app-muted);
  cursor: pointer;
  transition: all 0.15s;
}

.title-bar__btn:hover {
  background: var(--app-input-bg);
  color: var(--app-foreground);
}

.title-bar__back {
  -webkit-app-region: no-drag;
  app-region: no-drag;
  display: inline-flex;
  align-items: center;
  gap: 0.15rem;
  height: 24px;
  padding: 0 0.5rem 0 0.35rem;
  border-radius: 0.375rem;
  border: none;
  background: transparent;
  font-size: 12px;
  font-weight: 500;
  color: var(--app-muted);
  cursor: pointer;
  transition: all 0.15s;
}

.title-bar__back:hover {
  background: var(--app-input-bg);
  color: var(--app-foreground);
}

.title-bar__ask {
  -webkit-app-region: no-drag;
  app-region: no-drag;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 24px;
  border-radius: 0.375rem;
  color: var(--app-muted);
  cursor: pointer;
  transition: all 0.15s;
}

.title-bar__ask:hover {
  background: var(--app-input-bg);
  color: var(--app-foreground);
}

.title-bar__ask--active {
  background: color-mix(in srgb, var(--app-accent) 15%, transparent);
  color: var(--app-accent);
}
</style>
