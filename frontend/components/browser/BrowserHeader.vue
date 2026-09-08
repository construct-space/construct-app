<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { showContextMenu } from "@/composables/useNativeContextMenu";
import BrowserAddressBar from "./BrowserAddressBar.vue";
import type {
  BrowserMode,
  BrowserProfileViewModel,
  BrowserTabViewModel,
} from "./types";

const props = defineProps<{
  mode: BrowserMode;
  address: string;
  tabs: BrowserTabViewModel[];
  activeId: string | null;
  canGoBack: boolean;
  canGoForward: boolean;
  profiles: BrowserProfileViewModel[];
  profileName: string;
  profileEmail: string;
  profileAvatar: string | null;
  activeProfileId: string | null;
  activeTabZoom: number;
}>();

const emit = defineEmits<{
  (e: "update:address", value: string): void;
  (e: "submit-address", value: string): void;
  (e: "back"): void;
  (e: "forward"): void;
  (e: "reload"): void;
  (e: "activate-tab", id: string): void;
  (e: "close-tab", id: string): void;
  (e: "new-tab"): void;
  (e: "reorder-tab", payload: { fromId: string; toIndex: number }): void;
  (e: "switch-profile", id: string): void;
  (e: "open-settings"): void;
  (e: "reset-zoom"): void;
  (e: "tab-context-menu", payload: { tabId: string; clientX: number; clientY: number }): void;
}>();

const addressBar = ref<InstanceType<typeof BrowserAddressBar> | null>(null);
const tabsRef = ref<HTMLElement | null>(null);
const draggedTabId = ref<string | null>(null);
const pointerDownTabId = ref<string | null>(null);
const pointerStartX = ref(0);
const pointerStartY = ref(0);
const suppressClickUntil = ref(0);
const PROFILE_MENU_ESTIMATED_WIDTH = 340;

const showChrome = computed(() => props.mode !== "preview");
const showAddressBar = computed(() => props.mode === "browser");
const showTabs = computed(() => props.mode === "browser");
const activeTabLoading = computed(() => {
  const activeTab = props.tabs.find((tab) => tab.id === props.activeId);
  return activeTab?.loading ?? false;
});
const profileInitials = computed(() => {
  const source = props.profileName.trim() || props.profileEmail.trim() || "Profile";
  return source
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("") || "P";
});
const zoomPercentage = computed(() => {
  return Math.round(props.activeTabZoom * 100);
});
const showZoomChip = computed(() => {
  return props.activeTabZoom !== 1.0;
});

function focusAddressBar(select = true) {
  addressBar.value?.focusAddressBar(select);
}

function openSettings() {
  emit("open-settings");
}

function openNewTab() {
  emit("new-tab");
}

function switchProfile(profileId: string) {
  emit("switch-profile", profileId);
}

function handleTabContextMenu(event: MouseEvent, tabId: string) {
  event.preventDefault();
  emit("tab-context-menu", {
    tabId,
    clientX: event.clientX,
    clientY: event.clientY,
  });
}

async function openProfileMenu(event: MouseEvent) {
  event.preventDefault();
  const button = event.currentTarget as HTMLElement | null;

  const groups = [
    [
      { label: props.profileName || "Profile", disabled: true },
      ...(props.profileEmail
        ? [{ label: props.profileEmail, disabled: true }]
        : []),
    ],
    props.profiles.map((profile) => ({
      label:
        `${profile.id === props.activeProfileId ? "✓ " : ""}${profile.name}` +
        (profile.email ? ` (${profile.email})` : ""),
      disabled: profile.id === props.activeProfileId,
      onSelect: () => switchProfile(profile.id),
    })),
    [
      { label: "New tab", onSelect: () => openNewTab() },
      { label: "Browser settings", onSelect: () => openSettings() },
    ],
  ].filter((group) => group.length > 0);

  if (!button) {
    await showContextMenu(groups);
    return;
  }

  const rect = button.getBoundingClientRect();
  await showContextMenu(groups, {
    x: Math.max(12, rect.right - PROFILE_MENU_ESTIMATED_WIDTH),
    y: rect.bottom + 6,
  });
}

function onTabPointerDown(id: string, event: PointerEvent) {
  const target = event.target as HTMLElement | null;
  if (event.button !== 0 || target?.closest(".tab-close")) return;
  // Don't allow dragging pinned tabs
  const tab = props.tabs.find(t => t.id === id);
  if (tab?.pinned) return;
  pointerDownTabId.value = id;
  pointerStartX.value = event.clientX;
  pointerStartY.value = event.clientY;
}

function targetTabIndex(clientX: number): number | null {
  const elements = tabsRef.value?.querySelectorAll<HTMLElement>("[data-tab-id]");
  if (!elements?.length) return null;

  const draggedId = draggedTabId.value;
  if (!draggedId) return null;

  const tabs = Array.from(elements)
    .map((element) => ({
      id: element.dataset.tabId || "",
      center: element.getBoundingClientRect().left + element.getBoundingClientRect().width / 2,
    }))
    .filter((tab) => tab.id && tab.id !== draggedId);

  if (!tabs.length) return 0;
  return tabs.filter((tab) => clientX > tab.center).length;
}

function onWindowPointerMove(event: PointerEvent) {
  if (!pointerDownTabId.value) return;

  const movedFarEnough =
    Math.abs(event.clientX - pointerStartX.value) > 6 ||
    Math.abs(event.clientY - pointerStartY.value) > 6;

  if (!draggedTabId.value && !movedFarEnough) return;
  if (!draggedTabId.value) {
    draggedTabId.value = pointerDownTabId.value;
  }

  const toIndex = targetTabIndex(event.clientX);
  if (toIndex === null || !draggedTabId.value) return;

  emit("reorder-tab", { fromId: draggedTabId.value, toIndex });
  event.preventDefault();
}

function onWindowPointerUp() {
  if (draggedTabId.value) {
    suppressClickUntil.value = Date.now() + 160;
  }
  pointerDownTabId.value = null;
  draggedTabId.value = null;
}

function onTabClick(id: string, event: MouseEvent) {
  if (Date.now() < suppressClickUntil.value) {
    event.preventDefault();
    event.stopPropagation();
    return;
  }
  emit("activate-tab", id);
}

onMounted(() => {
  window.addEventListener("pointermove", onWindowPointerMove);
  window.addEventListener("pointerup", onWindowPointerUp);
});

onBeforeUnmount(() => {
  window.removeEventListener("pointermove", onWindowPointerMove);
  window.removeEventListener("pointerup", onWindowPointerUp);
});

defineExpose({
  focusAddressBar,
});
</script>

<template>
  <div class="browser-header">
    <header v-if="showChrome" class="chrome" data-tauri-drag-region>
      <div class="chrome-left">
        <!-- Task 38: Add ARIA labels for accessibility -->
        <button
          type="button"
          class="nav-btn"
          aria-label="Back (Cmd+[)"
          title="Back"
          :disabled="!canGoBack"
          @click="emit('back')"
        >
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"
            stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <button
          type="button"
          class="nav-btn"
          aria-label="Forward (Cmd+])"
          title="Forward"
          :disabled="!canGoForward"
          @click="emit('forward')"
        >
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"
            stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </button>
        <button
          type="button"
          class="nav-btn"
          aria-label="Reload (Cmd+R)"
          title="Reload"
          @click="emit('reload')"
        >
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"
            stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <polyline points="23 4 23 10 17 10" />
            <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
          </svg>
        </button>
      </div>

      <div class="chrome-center">
        <div class="drag-pocket" data-tauri-drag-region="true" />
        <BrowserAddressBar
          v-if="showAddressBar"
          ref="addressBar"
          :address="address"
          :loading="activeTabLoading"
          @submit="emit('submit-address', $event)"
          @update:address="emit('update:address', $event)"
        />
        <button v-if="showZoomChip" type="button" class="zoom-chip" :title="`Reset zoom (${zoomPercentage}%)`" @click="emit('reset-zoom')">
          {{ zoomPercentage }}%
        </button>
        <div class="drag-pocket" data-tauri-drag-region="true" />
      </div>

      <div class="chrome-right">
        <div class="drag-pocket drag-pocket--tight" data-tauri-drag-region="true" />
        <button
          type="button"
          class="profile-chip"
          aria-label="Switch profile"
          title="Current profile"
          @click="openProfileMenu"
        >
          <span class="profile-avatar">
            <img
              v-if="profileAvatar"
              :src="profileAvatar"
              :alt="`${profileName} profile avatar`"
              referrerpolicy="no-referrer"
            />
            <span v-else>{{ profileInitials }}</span>
          </span>
          <span class="profile-chip__name">{{ profileName || "Profile" }}</span>
        </button>
      </div>
    </header>

    <div v-if="showTabs" class="tabs-row" data-tauri-drag-region>
      <div ref="tabsRef" class="tabs" role="tablist" aria-label="Browser tabs">
        <button
          v-for="tab in tabs"
          :key="tab.id"
          type="button"
          :data-tab-id="tab.id"
          class="tab"
          role="tab"
          :aria-selected="tab.id === activeId"
          :aria-label="`${tab.title || 'New Tab'}${tab.pinned ? ' (pinned)' : ''}`"
          :class="{
            active: tab.id === activeId,
            dragging: tab.id === draggedTabId,
            'tab--pinned': tab.pinned,
          }"
          :title="tab.url"
          @pointerdown="onTabPointerDown(tab.id, $event)"
          @click="onTabClick(tab.id, $event)"
          @contextmenu="handleTabContextMenu($event, tab.id)"
        >
          <span class="tab-favicon" :class="{ 'tab-favicon--fallback': !tab.favicon, 'tab-favicon--loading': tab.loading }">
            <svg
              v-if="tab.loading"
              class="tab-spinner"
              viewBox="0 0 24 24"
              width="16"
              height="16"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              aria-hidden="true"
            >
              <circle cx="12" cy="12" r="10" />
              <path d="M12 2a10 10 0 0 1 10 10" />
            </svg>
            <img v-else-if="tab.favicon" :src="tab.favicon" :alt="`${tab.title} favicon`" />
            <span v-else>{{ (tab.title || "N").slice(0, 1).toUpperCase() }}</span>
          </span>
          <span class="tab-title">{{ tab.title || "New Tab" }}</span>
          <span v-if="tab.pinned" class="tab-pin" title="Pinned" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor">
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm3.5-9c.83 0 1.5-.67 1.5-1.5S16.33 8 15.5 8 14 8.67 14 9.5s.67 1.5 1.5 1.5z" />
            </svg>
          </span>
          <button
            v-if="tabs.length > 1"
            type="button"
            class="tab-close"
            :aria-label="`Close ${tab.title || 'New Tab'}`"
            @click.stop="emit('close-tab', tab.id)"
          >
            ×
          </button>
        </button>
      </div>
      <button
        type="button"
        class="new-tab"
        aria-label="New tab (Cmd+T)"
        title="New tab"
        @click="emit('new-tab')"
      >
        +
      </button>
      <div class="tabs-drag-pocket" data-tauri-drag-region="true" />
    </div>
  </div>
</template>

<style scoped>
.browser-header {
  position: relative;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  background: var(--app-background);
  color: var(--app-foreground);
  user-select: none;
  -webkit-user-select: none;
}

.chrome {
  position: relative;
  flex-shrink: 0;
  display: grid;
  grid-template-columns: 106px minmax(0, 1fr) 190px;
  align-items: center;
  gap: 8px;
  padding: 6px 12px 6px 80px;
  background: var(--app-background);
  border-bottom: 1px solid var(--app-border);
  height: 44px;
  box-sizing: border-box;
  -webkit-app-region: drag;
}

.chrome-left {
  display: flex;
  align-items: center;
  gap: 4px;
}

.chrome-right {
  position: relative;
  display: flex;
  align-items: center;
  gap: 8px;
  justify-content: flex-end;
}

.chrome-center {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.nav-btn {
  width: 30px;
  height: 30px;
  border-radius: 999px;
  background: transparent;
  color: var(--app-muted);
  border: none;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  -webkit-app-region: no-drag;
  transition: background 0.12s ease, color 0.12s ease;
}

.nav-btn:hover:not(:disabled) {
  background: color-mix(in srgb, var(--app-foreground) 8%, transparent);
  color: var(--app-foreground);
}

.nav-btn:disabled {
  opacity: 0.35;
  cursor: default;
}


.profile-chip {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  max-width: 100%;
  height: 32px;
  padding: 0 8px 0 4px;
  border-radius: 8px;
  border: 1px solid transparent;
  background: transparent;
  color: var(--app-foreground);
  cursor: pointer;
  user-select: none;
  -webkit-user-select: none;
  -webkit-app-region: no-drag;
  transition: background 0.12s ease, border-color 0.12s ease;
}

.profile-chip:hover,
.profile-chip:focus-visible {
  background: color-mix(in srgb, var(--app-foreground) 6%, transparent);
  border-color: var(--app-border);
  outline: none;
}

.drag-pocket {
  width: 18px;
  height: 28px;
  flex-shrink: 0;
  border-radius: 6px;
  -webkit-app-region: drag !important;
}

.drag-pocket--tight {
  width: 14px;
}

.profile-chip__name {
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  font-size: 12px;
  font-weight: 600;
}

.profile-avatar {
  width: 24px;
  height: 24px;
  border-radius: 999px;
  overflow: hidden;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, var(--app-accent), color-mix(in srgb, var(--app-accent) 45%, #3ec8a4));
  color: var(--app-accent-foreground);
  font-size: 10px;
  font-weight: 700;
  flex-shrink: 0;
}

.profile-avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.profile-avatar--large {
  width: 38px;
  height: 38px;
  font-size: 12px;
}

.profile-avatar--tiny {
  width: 20px;
  height: 20px;
  font-size: 9px;
}

.tabs-row {
  flex-shrink: 0;
  display: flex;
  align-items: flex-end;
  gap: 2px;
  padding: 0 8px;
  background: var(--app-background);
  border-bottom: 1px solid var(--app-border);
  height: 36px;
  box-sizing: border-box;
  -webkit-app-region: drag;
}

.tabs {
  display: flex;
  align-items: flex-end;
  gap: 2px;
  flex: 1;
  min-width: 0;
  overflow-x: auto;
  scrollbar-width: none;
  -webkit-app-region: no-drag;
}

.tabs::-webkit-scrollbar {
  display: none;
}

.tab {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 150px;
  max-width: 240px;
  padding: 5px 10px 6px;
  border-radius: 8px 8px 0 0;
  color: var(--app-muted);
  font-size: 12px;
  cursor: pointer;
  user-select: none;
  -webkit-user-select: none;
  border: 1px solid transparent;
  border-bottom: none;
  background: transparent;
  -webkit-app-region: no-drag;
  transition: background 0.12s ease, color 0.12s ease;
}

.tab:hover {
  background: color-mix(in srgb, var(--app-foreground) 4%, transparent);
  color: var(--app-foreground);
}

.tab.active {
  background: var(--app-surface);
  color: var(--app-foreground);
  border-color: var(--app-border);
}

.tab.dragging {
  opacity: 0.72;
}

.tab--pinned {
  min-width: 48px;
  max-width: 120px;
  cursor: default;
}

.tab-favicon {
  width: 16px;
  height: 16px;
  border-radius: 4px;
  overflow: hidden;
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.tab-favicon img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.tab-favicon--fallback {
  background: var(--app-input-bg);
  color: var(--app-foreground);
  font-size: 9px;
  font-weight: 700;
}

.tab-favicon--loading {
  color: var(--app-accent);
}

.tab-spinner {
  animation: spinner-rotate 1s linear infinite;
  transform-origin: center;
}

@keyframes spinner-rotate {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}

.tab-title {
  flex: 1;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.tab-pin {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 12px;
  height: 12px;
  color: var(--app-accent);
  flex-shrink: 0;
}

.tab-close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border-radius: 4px;
  opacity: 0.6;
  -webkit-app-region: no-drag;
}

.tab-close:hover {
  background: color-mix(in srgb, var(--app-foreground) 10%, transparent);
  opacity: 1;
}

.new-tab {
  background: transparent;
  color: var(--app-muted);
  border: none;
  cursor: pointer;
  font-size: 16px;
  width: 28px;
  height: 28px;
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  user-select: none;
  -webkit-user-select: none;
  -webkit-app-region: no-drag;
  transition: background 0.12s ease, color 0.12s ease;
}

.new-tab:hover {
  background: color-mix(in srgb, var(--app-foreground) 6%, transparent);
  color: var(--app-foreground);
}

.tabs-drag-pocket {
  width: 24px;
  height: 28px;
  flex-shrink: 0;
  -webkit-app-region: drag !important;
}

.zoom-chip {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 28px;
  padding: 0 8px;
  border-radius: 6px;
  border: 1px solid var(--app-border);
  background: color-mix(in srgb, var(--app-foreground) 4%, transparent);
  color: var(--app-muted);
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  user-select: none;
  -webkit-user-select: none;
  -webkit-app-region: no-drag;
  flex-shrink: 0;
  transition: background 0.12s ease, border-color 0.12s ease, color 0.12s ease;
}

.zoom-chip:hover {
  background: color-mix(in srgb, var(--app-foreground) 8%, transparent);
  border-color: color-mix(in srgb, var(--app-foreground) 18%, transparent);
  color: var(--app-foreground);
}
</style>
