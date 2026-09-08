<script setup lang="ts">
import { invoke } from "@tauri-apps/api/core";
import { LogicalPosition, LogicalSize } from "@tauri-apps/api/dpi";
import { listen } from "@tauri-apps/api/event";
import { Webview } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { showContextMenu } from "@/composables/useNativeContextMenu";
import BrowserSettingsPage from "@/browser/BrowserSettingsPage.vue";
import BrowserHeader from "@/components/browser/BrowserHeader.vue";
import type {
  BrowserMode,
  BrowserProfileViewModel,
  BrowserTabViewModel,
} from "@/components/browser/types";
import { listenProfileChanged } from "@/lib/profileEvents";
import { useAuthStore } from "@/stores/auth";
import { useProfileStore } from "@/stores/profile";
import { CHROME_H, computeContentBounds, deriveNativeInsets } from "./layout";
import {
  BROWSER_LINK_CONTEXT_EVENT,
  BROWSER_LOADING_EVENT,
  BROWSER_PAGE_CONTEXT_EVENT,
  BROWSER_PAGE_STATE_EVENT,
  BROWSER_POPUP_EVENT,
  type BrowserLinkContextPayload,
  type BrowserLoadingPayload,
  type BrowserPageContextPayload,
  type BrowserPageStatePayload,
  type BrowserPopupPayload,
} from "./pageBridge";
import {
  DEFAULT_BROWSER_SETTINGS,
  DEFAULT_BROWSER_URL,
  INTERNAL_BLANK_URL,
  INTERNAL_BOOKMARKS_URL,
  INTERNAL_BROWSER_SETTINGS_URL,
  INTERNAL_DOWNLOADS_URL,
  getZoomForOrigin,
  loadBrowserSettings,
  normalizeBrowserTarget,
  saveBrowserSettings,
  setZoomForOrigin,
  type BrowserSettings,
} from "./settings";
import { shouldOpenPopupInNewTab } from "./popupRouting";
import { useBrowserShortcuts } from "@/browser/composables/useBrowserShortcuts";
import { useTabSession } from "@/browser/composables/useTabSession";
import BrowserFindBar from "@/components/browser/BrowserFindBar.vue";
import { buildFindScript } from "@/browser/findController";
import { useBrowserHistoryStore } from "@/stores/browserHistory";
import BrowserBookmarkPopover from "@/components/browser/BrowserBookmarkPopover.vue";
import BrowserBookmarksBar from "@/components/browser/BrowserBookmarksBar.vue";
import BrowserBookmarksPage from "@/browser/BrowserBookmarksPage.vue";
import BrowserDownloadsPage from "@/browser/BrowserDownloadsPage.vue";
import BrowserKeyboardHelpModal from "@/components/browser/BrowserKeyboardHelpModal.vue";

type BrowserCommandPayload = {
  command?: string | null;
  mode?: string | null;
  url?: string | null;
  title?: string | null;
  tabId?: string | null;
  target?: string | null;
};

type BrowserTabPatchPayload = {
  tabId?: string | null;
  url?: string | null;
  title?: string | null;
};

type BrowserTab = {
  id: string;
  label: string;
  url: string;
  title: string;
  favicon: string | null;
  webview: Webview | null;
  history: string[];
  historyIndex: number;
  loading: boolean;
  pinned: boolean;
  crashed: boolean;
  zoom: number;
};

const WINDOW_TITLE = "Construct Browser";
const BROWSER_EVENT = "browser:open-url";
const BROWSER_TAB_PATCH_EVENT = "browser:tab-patched";

const profileStore = useProfileStore();
const authStore = useAuthStore();
const historyStore = useBrowserHistoryStore();

const tabSession = useTabSession();
let isMounted = false;
const pendingInvokes = new Set<Promise<unknown>>();
let historyDebounceTimer: number | null = null;
const HISTORY_DEBOUNCE_MS = 3000; // Debounce history writes for 3 seconds

const shortcuts = useBrowserShortcuts({
  newTab: () => {
    if (!isMounted) return;
    void newTab(browserSettings.value.homeUrl || DEFAULT_BROWSER_URL);
  },
  closeTab: () => {
    if (!isMounted || !activeTab.value) return;
    void closeTab(activeTab.value.id);
  },
  reopenClosed: () => {
    if (!isMounted) return;
    const closed = tabSession.popClosed();
    if (closed) {
      void newTab(closed.url);
    }
  },
  focusAddress: () => {
    if (!isMounted) return;
    headerRef.value?.focusAddressBar(true);
  },
  reload: () => {
    if (!isMounted) return;
    void onReload();
  },
  back: () => {
    if (!isMounted) return;
    onBack();
  },
  forward: () => {
    if (!isMounted) return;
    onForward();
  },
  jumpTab: (n) => {
    if (!isMounted) return;
    if (n === -1) {
      const last = tabs.value[tabs.value.length - 1];
      if (last) void activateTab(last.id);
    } else if (n >= 1 && n <= 8) {
      const tab = tabs.value[n - 1];
      if (tab) void activateTab(tab.id);
    }
  },
  nextTab: () => {
    if (!isMounted || !activeTab.value) return;
    const idx = tabs.value.findIndex((t) => t.id === activeTab.value?.id);
    if (idx >= 0 && idx < tabs.value.length - 1) {
      void activateTab(tabs.value[idx + 1].id);
    }
  },
  prevTab: () => {
    if (!isMounted || !activeTab.value) return;
    const idx = tabs.value.findIndex((t) => t.id === activeTab.value?.id);
    if (idx > 0) {
      void activateTab(tabs.value[idx - 1].id);
    }
  },
  zoom: (delta) => {
    if (!isMounted || !activeTab.value) return;
    if (delta === 0) {
      activeTab.value.zoom = 1;
    } else {
      activeTab.value.zoom = Math.max(
        0.5,
        Math.min(2, activeTab.value.zoom + delta * 0.1),
      );
    }
    setZoomForOrigin(activeTab.value.url, activeTab.value.zoom, browserSettings.value);
    saveBrowserSettings(browserSettings.value);
    const promise = invoke("browser_set_zoom", {
      webviewLabel: activeTab.value.label || "",
      factor: activeTab.value.zoom,
    }).catch(() => {
      // Suppress unhandled rejections during unmount
    });
    pendingInvokes.add(promise);
    promise.finally(() => pendingInvokes.delete(promise));
  },
  toggleFind: () => {
    if (!isMounted) return;
    showFind.value = !showFind.value;
    if (!activeTab.value?.label) return;

    const label = activeTab.value.label;
    if (showFind.value) {
      if (!findScriptInjected.has(label)) {
        const script = buildFindScript();
        const promise = invoke("browser_eval_webview", {
          webviewLabel: label,
          script,
        })
          .then(() => {
            findScriptInjected.add(label);
            void invoke("browser_eval_webview", {
              webviewLabel: label,
              script: "window.__CONSTRUCT_FIND__.showBar()",
            });
          })
          .catch(() => {
            // Suppress unhandled rejections
          });
        pendingInvokes.add(promise);
        promise.finally(() => pendingInvokes.delete(promise));
      } else {
        const promise = invoke("browser_eval_webview", {
          webviewLabel: label,
          script: "window.__CONSTRUCT_FIND__.showBar()",
        }).catch(() => {});
        pendingInvokes.add(promise);
        promise.finally(() => pendingInvokes.delete(promise));
      }
    } else {
      if (findScriptInjected.has(label)) {
        const promise = invoke("browser_eval_webview", {
          webviewLabel: label,
          script: "window.__CONSTRUCT_FIND__.hideBar()",
        }).catch(() => {});
        pendingInvokes.add(promise);
        promise.finally(() => pendingInvokes.delete(promise));
      }
    }
  },
  toggleDevtools: () => {
    if (!isMounted || !activeTab.value?.label) return;
    const promise = invoke("browser_devtools_toggle", {
      webviewLabel: activeTab.value.label,
    }).catch(() => {
      // Suppress unhandled rejections during unmount
    });
    pendingInvokes.add(promise);
    promise.finally(() => pendingInvokes.delete(promise));
  },
  bookmarkCurrent: () => {
    if (!isMounted || !activeTab.value) return
    bookmarkData.value = {
      title: activeTab.value.title,
      url: activeTab.value.url,
      favicon: activeTab.value.favicon,
    }
    showBookmarkPopover.value = true
  },
  openDownloads: () => {
    if (!isMounted) return;
    void newTab(INTERNAL_DOWNLOADS_URL);
  },
});

const address = ref(DEFAULT_BROWSER_URL);
const activeId = ref<string | null>(null);
const mode = ref<BrowserMode>("browser");
const contentEl = ref<HTMLElement | null>(null);
const tabs = ref<BrowserTab[]>([]);
const titleOverride = ref<string | null>(null);
const browserSettings = ref<BrowserSettings>({ ...DEFAULT_BROWSER_SETTINGS });
const headerRef = ref<{ focusAddressBar: (select?: boolean) => void } | null>(
  null,
);
const popupTabIds = new Map<string, string>();

// Find-in-page state
const showFind = ref(false);
const findMatchCount = ref(0);
const findActiveIndex = ref(0);
const findScriptInjected = new Set<string>(); // Track which webviews have find script injected

// Bookmark popover state
const showBookmarkPopover = ref(false);
const bookmarkData = ref({ title: '', url: '', favicon: null as string | null });

// Task 32: Download handlers in Rust
// Foundation for download events is in store (useBrowserDownloadsStore).
// Rust bridge ready to emit download events via browser_download_started, browser_download_completed, etc.
// Future: Wire useBrowserDownloadsStore to listen for Tauri events and handle progress updates.

const showChrome = computed(() => mode.value !== "preview");
const showAddressBar = computed(() => mode.value === "browser");
const isSingleTabMode = computed(() => mode.value !== "browser");
const activeTab = computed(
  () => tabs.value.find((tab) => tab.id === activeId.value) ?? null,
);
const activeInternalPage = computed(() => {
  if (!activeTab.value) return null;
  if (activeTab.value.url === INTERNAL_BROWSER_SETTINGS_URL) {
    return "browser-settings";
  }
  if (activeTab.value.url === INTERNAL_BLANK_URL) {
    return "browser-blank";
  }
  if (activeTab.value.url === INTERNAL_BOOKMARKS_URL) {
    return "browser-bookmarks";
  }
  if (activeTab.value.url === INTERNAL_DOWNLOADS_URL) {
    return "browser-downloads";
  }
  return null;
});
const canGoBack = computed(
  () => !!activeTab.value && activeTab.value.historyIndex > 0,
);
const canGoForward = computed(
  () =>
    !!activeTab.value &&
    activeTab.value.historyIndex < activeTab.value.history.length - 1,
);
const headerTabs = computed<BrowserTabViewModel[]>(() =>
  tabs.value.map((tab) => ({
    id: tab.id,
    title: tab.title,
    url: tab.url,
    favicon: tab.favicon,
    loading: tab.loading,
    pinned: tab.pinned,
  })),
);
const browserProfiles = computed<BrowserProfileViewModel[]>(() =>
  profileStore.profiles.map((profile) => ({
    id: profile.id,
    name: profile.name,
    email: profile.email,
    avatar:
      profile.id === profileStore.activeProfileId
        ? authStore.userAvatar
        : profile.avatar ?? null,
  })),
);
const currentProfileName = computed(
  () => profileStore.activeProfile?.name || authStore.userName || "Profile",
);
const currentProfileEmail = computed(
  () => authStore.userEmail || profileStore.activeProfile?.email || "",
);
const currentProfileAvatar = computed(() => authStore.userAvatar || null);

let resizeObserver: ResizeObserver | null = null;
let unlistenCommand: (() => void) | null = null;
let unlistenTabPatch: (() => void) | null = null;
let unlistenPageState: (() => void) | null = null;
let unlistenPopup: (() => void) | null = null;
let unlistenLinkContext: (() => void) | null = null;
let unlistenPageContext: (() => void) | null = null;
let unlistenLoading: (() => void) | null = null;
let unlistenMenuProfileSwitch: (() => void) | null = null;
let unlistenProfileChanged: (() => void) | null = null;

function log(message: string) {
  console.log("[browser-main]", message);
}

function parseMode(value: string | null | undefined): BrowserMode {
  if (value === "preview" || value === "space-preview" || value === "browser") {
    return value;
  }
  return "browser";
}

function parseCommand(value: string | null | undefined): "open" | "close" {
  return value === "close" ? "close" : "open";
}

function fallbackUrlForMode(nextMode: BrowserMode): string {
  return nextMode === "browser"
    ? browserSettings.value.homeUrl || DEFAULT_BROWSER_URL
    : INTERNAL_BLANK_URL;
}

function normalizeUrl(raw: string): string {
  return normalizeBrowserTarget(raw, browserSettings.value, fallbackUrlForMode(mode.value));
}

function restorePinnedState() {
  for (const tab of tabs.value) {
    tab.pinned = browserSettings.value.pinnedTabUrls.includes(tab.url);
  }
  reorderPinnedTabs();
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function tabTitleForUrl(url: string): string {
  if (url === INTERNAL_BROWSER_SETTINGS_URL) return "Browser Settings";
  if (url === INTERNAL_BLANK_URL) return "New Tab";
  return hostOf(url) || "New Tab";
}

function nextTabId(): string {
  return `t${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function tabById(id: string | null | undefined): BrowserTab | null {
  if (!id) return null;
  return tabs.value.find((tab) => tab.id === id) ?? null;
}

function currentWindowTitle(): string {
  if (titleOverride.value) return titleOverride.value;
  const active = activeTab.value;
  return active?.title || hostOf(active?.url ?? "") || WINDOW_TITLE;
}

function readLaunchPayload(): BrowserCommandPayload {
  const params = new URLSearchParams(window.location.search);
  return {
    command: params.get("command"),
    mode: params.get("mode"),
    tabId: params.get("tabId"),
    target: params.get("target"),
    title: params.get("title"),
    url: params.get("url"),
  };
}

async function syncWindowTitle() {
  const nextTitle = currentWindowTitle();
  document.title = nextTitle;
  try {
    await getCurrentWindow().setTitle(nextTitle);
  } catch (error) {
    log(`title err: ${String(error)}`);
  }
}

function syncAddressBar() {
  if (activeTab.value) {
    address.value = activeTab.value.url;
  }
}

async function syncBrowserState() {
  try {
    await invoke("browser_sync_state", {
      tabs: tabs.value.map((tab) => ({
        id: tab.id,
        webviewLabel: tab.webview ? tab.label : null,
        url: tab.url,
        title: tab.title,
      })),
      activeTabId: activeId.value,
    });
  } catch (error) {
    log(`state sync err: ${String(error)}`);
  }
}

async function contentBounds() {
  const rect = contentEl.value?.getBoundingClientRect();
  const chromeHeight = mode.value === "browser" ? CHROME_H : showChrome.value ? 44 : 0;
  const appWindow = getCurrentWindow();
  const [fullscreen, scaleFactor, outerPosition, innerPosition] = await Promise.all([
    appWindow.isFullscreen(),
    appWindow.scaleFactor(),
    appWindow.outerPosition(),
    appWindow.innerPosition(),
  ]);

  return computeContentBounds({
    rect: {
      left: rect?.left ?? 0,
      top: rect?.top ?? 0,
      width: rect?.width ?? 0,
      height: rect?.height ?? 0,
    },
    viewport: {
      width: window.innerWidth,
      height: window.innerHeight,
    },
    chromeHeight,
    nativeInsets: deriveNativeInsets({
      fullscreen,
      scaleFactor,
      outerPosition,
      innerPosition,
    }),
  });
}


async function syncActiveWebview() {
  const bounds = await contentBounds();
  for (const tab of tabs.value) {
    if (!tab.webview) continue;
    try {
      if (tab.id === activeId.value && tab.url !== INTERNAL_BROWSER_SETTINGS_URL) {
        await tab.webview.setPosition(new LogicalPosition(bounds.x, bounds.y));
        await tab.webview.setSize(new LogicalSize(bounds.width, bounds.height));
        await tab.webview.show();
      } else {
        await tab.webview.hide();
      }
    } catch (error) {
      log(`sync err: ${String(error)}`);
    }
  }

  syncAddressBar();
}

async function closeWebview(tab: BrowserTab) {
  if (!tab.webview) return;
  try {
    await tab.webview.close();
  } catch {
    // Ignore stale close races while tabs are being recreated.
  } finally {
    tab.webview = null;
  }
}

async function mountWebview(tab: BrowserTab) {
  if (tab.url === INTERNAL_BROWSER_SETTINGS_URL || tab.url === INTERNAL_BLANK_URL) {
    await closeWebview(tab);
    return;
  }

  await closeWebview(tab);

  const bounds = await contentBounds();
  const label = `tab-${tab.id}-${Date.now()}`;
  tab.label = label;

  try {
    await invoke("browser_create_webview", {
      // Attach the child page-webview to THIS window. Preview windows use a
      // `browser-<nonce>` label, not the standalone `browser-main`, so the
      // host must not hardcode the parent — otherwise the preview stays blank.
      windowLabel: getCurrentWindow().label,
      tabId: tab.id,
      webviewLabel: label,
      url: tab.url,
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
    });
    const webview = await Webview.getByLabel(label);
    if (!webview) {
      throw new Error(`created webview not found: ${label}`);
    }

    tab.webview = webview;
    void syncBrowserState();
    void syncActiveWebview();
    void syncWindowTitle();
    void syncBrowserState();
    webview.once("tauri://error", (event) => {
      log(`webview err: ${JSON.stringify(event.payload)}`);
      const errTab = tabById(tab.id);
      if (errTab) {
        errTab.crashed = true;
      }
    });
  } catch (error) {
    log(`mount err: ${String(error)}`);
  }
}

function syncHistoryFromObservedUrl(tab: BrowserTab, nextUrl: string) {
  const current = tab.history[tab.historyIndex];
  if (current === nextUrl) return;

  if (tab.history[tab.historyIndex + 1] === nextUrl) {
    tab.historyIndex += 1;
    return;
  }

  if (tab.history[tab.historyIndex - 1] === nextUrl) {
    tab.historyIndex -= 1;
    return;
  }

  tab.history = tab.history.slice(0, tab.historyIndex + 1);
  tab.history.push(nextUrl);
  tab.historyIndex = tab.history.length - 1;
}

function clearCrashedState(tab: BrowserTab) {
  tab.crashed = false
}

async function navigateTab(tab: BrowserTab, raw: string, pushHistory = true) {
  const url = normalizeUrl(raw);

  if (pushHistory) {
    const current = tab.history[tab.historyIndex];
    if (current !== url) {
      tab.history = tab.history.slice(0, tab.historyIndex + 1);
      tab.history.push(url);
      tab.historyIndex = tab.history.length - 1;
    }
  } else if (!tab.history.length) {
    tab.history = [url];
    tab.historyIndex = 0;
  }

  tab.url = url;
  tab.title = tabTitleForUrl(url);
  clearCrashedState(tab);

  // Load zoom for this origin before mounting
  const saved = getZoomForOrigin(url, browserSettings.value);
  if (saved !== 1.0) {
    tab.zoom = saved;
  }

  if (url === INTERNAL_BROWSER_SETTINGS_URL || url === INTERNAL_BLANK_URL) {
    tab.favicon = null;
    await closeWebview(tab);
  } else {
    await mountWebview(tab);
  }

  syncAddressBar();
  await syncWindowTitle();
  void syncBrowserState();
}

async function navigateActive(raw: string, pushHistory = true) {
  if (!activeTab.value) {
    await newTab(raw);
    return;
  }

  await navigateTab(activeTab.value, raw, pushHistory);
  await syncActiveWebview();
}

async function newTab(
  raw: string,
  forcedId?: string,
  options: { activate?: boolean } = {},
): Promise<BrowserTab | null> {
  const activate = options.activate !== false;

  if (forcedId) {
    const existing = tabById(forcedId);
    if (existing) {
      if (activate) {
        activeId.value = existing.id;
      }
      await navigateTab(existing, raw);
      await syncActiveWebview();
      return existing;
    }
  }

  if (isSingleTabMode.value && tabs.value.length > 0) {
    await navigateActive(raw);
    return activeTab.value;
  }

  const url = normalizeUrl(raw);
  const tab: BrowserTab = {
    id: forcedId ?? nextTabId(),
    label: "",
    title: tabTitleForUrl(url),
    url,
    favicon: null,
    webview: null,
    history: [url],
    historyIndex: 0,
    loading: false,
    pinned: false,
    crashed: false,
    zoom: 1.0,
  };

  tabs.value.push(tab);
  if (activate || !activeId.value) {
    activeId.value = tab.id;
  }
  syncAddressBar();
  void syncBrowserState();

  if (url !== INTERNAL_BROWSER_SETTINGS_URL && url !== INTERNAL_BLANK_URL) {
    await mountWebview(tab);
  }

  await syncActiveWebview();
  await syncWindowTitle();
  return tab;
}

async function activateTab(id: string) {
  activeId.value = id;
  const tab = tabById(id);
  if (tab && tab.zoom !== 1.0 && tab.label) {
    const promise = invoke("browser_set_zoom", {
      webviewLabel: tab.label,
      factor: tab.zoom,
    }).catch(() => {
      // Suppress unhandled rejections during unmount
    });
    pendingInvokes.add(promise);
    promise.finally(() => pendingInvokes.delete(promise));
  }
  syncAddressBar();
  await syncActiveWebview();
  await syncWindowTitle();
  void syncBrowserState();
}

async function closeTab(id: string) {
  if (isSingleTabMode.value && tabs.value.length <= 1) return;

  const index = tabs.value.findIndex((tab) => tab.id === id);
  if (index < 0) return;

  const [tab] = tabs.value.splice(index, 1);

  // Record in session before closing webview
  if (
    tab.url !== INTERNAL_BROWSER_SETTINGS_URL &&
    tab.url !== INTERNAL_BLANK_URL
  ) {
    tabSession.pushClosed({ url: tab.url, title: tab.title });
  }

  await closeWebview(tab);
  for (const [popupId, popupTabId] of popupTabIds.entries()) {
    if (popupTabId === id) popupTabIds.delete(popupId);
  }

  if (activeId.value === id) {
    const next = tabs.value[index] ?? tabs.value[index - 1] ?? tabs.value[0] ?? null;
    activeId.value = next?.id ?? null;
  }

  syncAddressBar();
  await syncActiveWebview();
  await syncWindowTitle();
  void syncBrowserState();
}

async function replaceTabLocation(tab: BrowserTab, raw: string) {
  const url = normalizeUrl(raw);
  tab.history = [url];
  tab.historyIndex = 0;
  tab.url = url;
  tab.title = tabTitleForUrl(url);
  tab.favicon = null;

  if (url === INTERNAL_BROWSER_SETTINGS_URL || url === INTERNAL_BLANK_URL) {
    await closeWebview(tab);
  } else {
    await mountWebview(tab);
  }

  if (activeId.value === tab.id) {
    syncAddressBar();
    await syncWindowTitle();
  }

  void syncBrowserState();
}

async function stepHistory(offset: -1 | 1) {
  if (!activeTab.value) return;

  const nextIndex = activeTab.value.historyIndex + offset;
  if (nextIndex < 0 || nextIndex >= activeTab.value.history.length) return;

  activeTab.value.historyIndex = nextIndex;
  await navigateTab(activeTab.value, activeTab.value.history[nextIndex], false);
  await syncActiveWebview();
}

async function trimTabsForMode() {
  if (!isSingleTabMode.value || tabs.value.length <= 1) return;

  const keepId = activeId.value ?? tabs.value[0]?.id ?? null;
  const toClose = tabs.value.filter((tab) => tab.id !== keepId);
  tabs.value = tabs.value.filter((tab) => tab.id === keepId);

  for (const tab of toClose) {
    await closeWebview(tab);
  }

  void syncBrowserState();
}

async function patchTabState(payload: BrowserTabPatchPayload) {
  const tabId = payload.tabId?.trim();
  const tab = tabById(tabId);
  if (!tab) return;

  if (payload.url?.trim()) {
    const nextUrl = payload.url.trim();
    tab.url = nextUrl;
    syncHistoryFromObservedUrl(tab, nextUrl);
  }
  if (payload.title !== undefined && payload.title !== null) {
    const title = payload.title.trim();
    tab.title = title || tabTitleForUrl(tab.url);
  }

  if (activeId.value === tab.id) {
    syncAddressBar();
    await syncWindowTitle();
  }

  void syncBrowserState();
}

function recordPageHistory(payload: BrowserPageStatePayload) {
  // Clear existing timer
  if (historyDebounceTimer) {
    clearTimeout(historyDebounceTimer)
  }

  // Set new timer
  historyDebounceTimer = window.setTimeout(() => {
    historyStore.add({
      url: payload.url,
      title: payload.title || 'New Page',
      favicon: payload.favicon,
    })
    historyDebounceTimer = null
  }, HISTORY_DEBOUNCE_MS)
}

async function handlePageState(payload: BrowserPageStatePayload) {
  const tab = tabById(payload.tabId);
  if (!tab || payload.webviewLabel !== tab.label) return;

  const nextUrl = `${payload.url || ""}`.trim();
  if (nextUrl) {
    tab.url = nextUrl;
    syncHistoryFromObservedUrl(tab, nextUrl);

    // Apply saved zoom for this origin if it exists
    const saved = getZoomForOrigin(nextUrl, browserSettings.value);
    if (saved !== 1.0 && saved !== tab.zoom) {
      tab.zoom = saved;
      const promise = invoke("browser_set_zoom", {
        webviewLabel: tab.label || "",
        factor: tab.zoom,
      }).catch(() => {
        // Suppress unhandled rejections during unmount
      });
      pendingInvokes.add(promise);
      promise.finally(() => pendingInvokes.delete(promise));
    }
  }

  const nextTitle = `${payload.title || ""}`.trim();
  tab.title = nextTitle || tabTitleForUrl(tab.url);
  tab.favicon = `${payload.favicon || ""}`.trim() || null;

  // Record in history (debounced)
  recordPageHistory(payload)

  if (activeId.value === tab.id) {
    syncAddressBar();
    await syncWindowTitle();
  }

  void syncBrowserState();
}

async function handleLoading(payload: BrowserLoadingPayload) {
  const tab = tabById(payload.tabId);
  if (!tab || payload.webviewLabel !== tab.label) return;

  tab.loading = payload.loading;
  void syncBrowserState();
}

async function handlePopupRequest(payload: BrowserPopupPayload) {
  const tab = tabById(payload.tabId);
  if (!tab || payload.webviewLabel !== tab.label) return;

  const popupId = `${payload.popupId || ""}`.trim() || null;
  const nextUrl = `${payload.url || ""}`.trim() || INTERNAL_BLANK_URL;
  const foreground = payload.foreground !== false;

  if (popupId) {
    const popupTab = tabById(popupTabIds.get(popupId) ?? null);
    if (!popupTab) {
      const created = await newTab(nextUrl, undefined, { activate: foreground });
      if (created) popupTabIds.set(popupId, created.id);
      return;
    }

    if (foreground) {
      activeId.value = popupTab.id;
    }
    const shouldReplaceBlank =
      popupTab.history.length === 1 && popupTab.history[0] === INTERNAL_BLANK_URL;

    if (shouldReplaceBlank) {
      await replaceTabLocation(popupTab, nextUrl);
    } else if (nextUrl !== INTERNAL_BLANK_URL) {
      await navigateTab(popupTab, nextUrl);
    }

    await syncActiveWebview();
    return;
  }

  if (!nextUrl || nextUrl === INTERNAL_BLANK_URL) return;

  if (shouldOpenPopupInNewTab(payload, browserSettings.value.openExternalLinksInNewTab)) {
    await newTab(nextUrl, undefined, { activate: foreground });
    return;
  }

  activeId.value = tab.id;
  await navigateTab(tab, nextUrl);
  await syncActiveWebview();
}

async function navigateContextLink(tab: BrowserTab, raw: string) {
  activeId.value = tab.id;
  await navigateTab(tab, raw);
  await syncActiveWebview();
}

async function handleLinkContextRequest(payload: BrowserLinkContextPayload) {
  const tab = tabById(payload.tabId);
  if (!tab || payload.webviewLabel !== tab.label) return;

  const nextUrl = `${payload.url || ""}`.trim();
  if (!nextUrl || !/^(https?:|about:)/i.test(nextUrl)) return;

  const bounds = await contentBounds();
  await showContextMenu(
    [
      [
        {
          label: "Open Link in New Tab",
          onSelect: () => {
            void newTab(nextUrl);
          },
        },
        {
          label: "Open Link Here",
          onSelect: () => {
            void navigateContextLink(tab, nextUrl);
          },
        },
      ],
    ],
    {
      x: Math.max(bounds.x, bounds.x + Math.round(payload.clientX || 0)),
      y: Math.max(bounds.y, bounds.y + Math.round(payload.clientY || 0)),
    },
  );
}

async function handlePageContextRequest(payload: BrowserPageContextPayload) {
  const tab = tabById(payload.tabId);
  if (!tab || payload.webviewLabel !== tab.label) return;

  const bounds = await contentBounds();
  const menuItems: Array<{ label: string; onSelect: () => void }> = [];

  // Back
  if (canGoBack.value && payload.canGoBack) {
    menuItems.push({
      label: 'Back',
      onSelect: () => void onBack(),
    });
  }

  // Forward
  if (canGoForward.value && payload.canGoForward) {
    menuItems.push({
      label: 'Forward',
      onSelect: () => void onForward(),
    });
  }

  // Reload
  menuItems.push({
    label: 'Reload',
    onSelect: () => void onReload(),
  });

  // New Tab
  menuItems.push({
    label: 'New Tab',
    onSelect: () => void newTab(browserSettings.value.homeUrl || DEFAULT_BROWSER_URL),
  });

  // Find
  menuItems.push({
    label: 'Find in Page',
    onSelect: () => { showFind.value = true },
  });

  if (menuItems.length === 0) return;

  await showContextMenu([menuItems], {
    x: Math.max(bounds.x, bounds.x + Math.round(payload.clientX || 0)),
    y: Math.max(bounds.y, bounds.y + Math.round(payload.clientY || 0)),
  });
}

function handlePinTab(tabId: string) {
  const tab = tabs.value.find(t => t.id === tabId);
  if (!tab) return;

  // Toggle pin state
  tab.pinned = !tab.pinned;

  // Persist in settings
  if (tab.pinned) {
    if (!browserSettings.value.pinnedTabUrls.includes(tab.url)) {
      browserSettings.value.pinnedTabUrls.push(tab.url);
    }
  } else {
    const idx = browserSettings.value.pinnedTabUrls.indexOf(tab.url);
    if (idx >= 0) {
      browserSettings.value.pinnedTabUrls.splice(idx, 1);
    }
  }

  saveBrowserSettings(browserSettings.value);
  reorderPinnedTabs();
}

function reorderPinnedTabs() {
  const pinned = tabs.value.filter(t => t.pinned);
  const unpinned = tabs.value.filter(t => !t.pinned);
  tabs.value = [...pinned, ...unpinned];
}

async function handleTabContextMenu(tabId: string, clientX: number, clientY: number) {
  const tab = tabs.value.find(t => t.id === tabId);
  const bounds = await contentBounds();
  await showContextMenu(
    [
      [
        { label: 'Close', onSelect: () => void closeTab(tabId) },
        { label: 'Duplicate', onSelect: () => { /* TODO: duplicate tab */ } },
        { label: tab?.pinned ? 'Unpin' : 'Pin', onSelect: () => handlePinTab(tabId) },
      ],
    ],
    {
      x: Math.max(bounds.x, Math.round(clientX)),
      y: Math.max(bounds.y, Math.round(clientY)),
    }
  );
}

function reorderTab(payload: { fromId: string; toIndex: number }) {
  const fromIndex = tabs.value.findIndex((tab) => tab.id === payload.fromId);
  if (fromIndex < 0) return;

  const [tab] = tabs.value.splice(fromIndex, 1);
  const nextIndex = Math.max(0, Math.min(payload.toIndex, tabs.value.length));
  if (fromIndex === nextIndex) {
    tabs.value.splice(fromIndex, 0, tab);
    return;
  }
  tabs.value.splice(nextIndex, 0, tab);
  void syncBrowserState();
}

function openBrowserSettings() {
  const existing = tabs.value.find((tab) => tab.url === INTERNAL_BROWSER_SETTINGS_URL);
  if (existing) {
    void activateTab(existing.id);
    return;
  }
  void newTab(INTERNAL_BROWSER_SETTINGS_URL);
}

function applyBrowserSettings(next: BrowserSettings) {
  browserSettings.value = saveBrowserSettings(next);
}

function resetBrowserSettings() {
  browserSettings.value = saveBrowserSettings(DEFAULT_BROWSER_SETTINGS);
}

async function switchProfile(profileId: string) {
  const nextId = `${profileId || ""}`.trim();
  if (!nextId || nextId === profileStore.activeProfileId) return;
  try {
    await profileStore.switchProfile(nextId);
  } catch (error) {
    log(`profile switch err: ${String(error)}`);
  }
}

async function applyBrowserCommand(payload: BrowserCommandPayload) {
  const command = parseCommand(payload.command);
  if (command === "close") {
    const tabId = payload.tabId?.trim();
    if (tabId) await closeTab(tabId);
    return;
  }

  mode.value = parseMode(payload.mode);
  if (payload.title !== undefined) {
    titleOverride.value = payload.title?.trim() || null;
  }

  await trimTabsForMode();
  await nextTick();

  const targetUrl = payload.url?.trim();
  const tabId = payload.tabId?.trim() || null;
  const target = payload.target?.trim() || null;

  if (target === "new-tab") {
    await newTab(targetUrl ?? fallbackUrlForMode(mode.value), tabId ?? undefined);
    return;
  }

  if (tabId) {
    const existing = tabById(tabId);
    if (existing) {
      activeId.value = existing.id;
      if (targetUrl) {
        await navigateTab(existing, targetUrl);
      } else {
        await syncActiveWebview();
        await syncWindowTitle();
      }
      void syncBrowserState();
      return;
    }

    await newTab(targetUrl ?? fallbackUrlForMode(mode.value), tabId);
    return;
  }

  if (targetUrl) {
    await navigateActive(targetUrl);
  } else if (!tabs.value.length) {
    await newTab(fallbackUrlForMode(mode.value));
  } else {
    await syncActiveWebview();
    await syncWindowTitle();
  }
}

async function onSubmitAddress(nextAddress?: string) {
  titleOverride.value = null;
  const next = nextAddress?.trim() || address.value;
  address.value = next;
  await navigateActive(next);
}

async function onReload() {
  if (!activeTab.value) return;
  if (activeInternalPage.value === "browser-settings") {
    browserSettings.value = loadBrowserSettings();
    return;
  }
  if (
    activeInternalPage.value === "browser-blank"
    || activeInternalPage.value === "browser-bookmarks"
    || activeInternalPage.value === "browser-downloads"
  ) {
    return;
  }
  clearCrashedState(activeTab.value);
  await navigateTab(activeTab.value, activeTab.value.url, false);
  await syncActiveWebview();
}

function onBack() {
  void stepHistory(-1);
}

function onForward() {
  void stepHistory(1);
}

function handleResize() {
  void syncActiveWebview();
}

watch(
  () => profileStore.activeProfileId,
  () => {
    browserSettings.value = loadBrowserSettings();
  },
);

function handleFindSearch(text: string) {
  if (!activeTab.value?.label) return;
  const script = `window.__CONSTRUCT_FIND__.find(${JSON.stringify(text)})`;
  const promise = invoke("browser_eval_webview", {
    webviewLabel: activeTab.value.label,
    script,
  }).catch(() => {
    // Suppress unhandled rejections
  });
  pendingInvokes.add(promise);
  promise.finally(() => pendingInvokes.delete(promise));
}

function handleFindNext() {
  if (!activeTab.value?.label) return;
  const promise = invoke("browser_eval_webview", {
    webviewLabel: activeTab.value.label,
    script: "window.__CONSTRUCT_FIND__.next()",
  }).catch(() => {
    // Suppress unhandled rejections
  });
  pendingInvokes.add(promise);
  promise.finally(() => pendingInvokes.delete(promise));
}

function handleFindPrev() {
  if (!activeTab.value?.label) return;
  const promise = invoke("browser_eval_webview", {
    webviewLabel: activeTab.value.label,
    script: "window.__CONSTRUCT_FIND__.prev()",
  }).catch(() => {
    // Suppress unhandled rejections
  });
  pendingInvokes.add(promise);
  promise.finally(() => pendingInvokes.delete(promise));
}

function handleBookmarkSaved() {
  showBookmarkPopover.value = false;
}

async function bootstrap() {
  const initialPayload = readLaunchPayload();
  mode.value = parseMode(initialPayload.mode);
  titleOverride.value = initialPayload.title?.trim() || null;

  browserSettings.value = loadBrowserSettings();
  await profileStore.init();
  if (profileStore.hasProfiles) {
    await authStore.initialize();
  }
  browserSettings.value = loadBrowserSettings();

  await nextTick();

  resizeObserver = new ResizeObserver(() => {
    void syncActiveWebview();
  });
  if (contentEl.value) {
    resizeObserver.observe(contentEl.value);
  }

  window.addEventListener("resize", handleResize);
  unlistenCommand = await listen<BrowserCommandPayload>(BROWSER_EVENT, (event) => {
    void applyBrowserCommand(event.payload ?? {});
  });
  unlistenTabPatch = await listen<BrowserTabPatchPayload>(
    BROWSER_TAB_PATCH_EVENT,
    (event) => {
      void patchTabState(event.payload ?? {});
    },
  );
  unlistenPageState = await listen<BrowserPageStatePayload>(
    BROWSER_PAGE_STATE_EVENT,
    (event) => {
      void handlePageState(event.payload);
    },
  );
  unlistenPopup = await listen<BrowserPopupPayload>(BROWSER_POPUP_EVENT, (event) => {
    void handlePopupRequest(event.payload);
  });
  unlistenLinkContext = await listen<BrowserLinkContextPayload>(
    BROWSER_LINK_CONTEXT_EVENT,
    (event) => {
      void handleLinkContextRequest(event.payload);
    },
  );
  unlistenPageContext = await listen<BrowserPageContextPayload>(
    BROWSER_PAGE_CONTEXT_EVENT,
    (event) => {
      void handlePageContextRequest(event.payload);
    },
  );
  unlistenLoading = await listen<BrowserLoadingPayload>(BROWSER_LOADING_EVENT, (event) => {
    void handleLoading(event.payload);
  });
  unlistenMenuProfileSwitch = await listen<string>("menu:switch-profile", (event) => {
    void switchProfile(`${event.payload || ""}`.trim());
  });
  unlistenProfileChanged = await listenProfileChanged(async (payload) => {
    await switchProfile(payload.id);
  });

  await new Promise((resolve) => requestAnimationFrame(resolve));
  await new Promise((resolve) => requestAnimationFrame(resolve));

  await applyBrowserCommand(initialPayload);
  if (!tabs.value.length) {
    await newTab(fallbackUrlForMode(mode.value));
  }
  restorePinnedState();
  await syncWindowTitle();

  if (showAddressBar.value) {
    await nextTick();
    headerRef.value?.focusAddressBar();
  }
}

onMounted(() => {
  isMounted = true;
  void bootstrap();
});

onBeforeUnmount(async () => {
  isMounted = false;
  shortcuts.dispose();

  // Clear history debounce timer
  if (historyDebounceTimer) {
    clearTimeout(historyDebounceTimer);
    historyDebounceTimer = null;
  }

  // Wait for pending invokes to complete or timeout after 1s
  const timeout = new Promise<void>((resolve) => {
    setTimeout(resolve, 1000);
  });
  await Promise.race([
    Promise.all(Array.from(pendingInvokes)),
    timeout,
  ]).catch(() => {
    // Suppress errors from pending requests
  });

  window.removeEventListener("resize", handleResize);
  resizeObserver?.disconnect();
  resizeObserver = null;
  unlistenCommand?.();
  unlistenCommand = null;
  unlistenTabPatch?.();
  unlistenTabPatch = null;
  unlistenPageState?.();
  unlistenPageState = null;
  unlistenPopup?.();
  unlistenPopup = null;
  unlistenLinkContext?.();
  unlistenLinkContext = null;
  unlistenPageContext?.();
  unlistenPageContext = null;
  unlistenLoading?.();
  unlistenLoading = null;
  unlistenMenuProfileSwitch?.();
  unlistenMenuProfileSwitch = null;
  unlistenProfileChanged?.();
  unlistenProfileChanged = null;

  for (const tab of tabs.value) {
    void closeWebview(tab);
  }
});
</script>

<template>
  <div class="shell" :data-mode="mode">
    <BrowserHeader
      ref="headerRef"
      :mode="mode"
      :address="address"
      :tabs="headerTabs"
      :active-id="activeId"
      :can-go-back="canGoBack"
      :can-go-forward="canGoForward"
      :profiles="browserProfiles"
      :profile-name="currentProfileName"
      :profile-email="currentProfileEmail"
      :profile-avatar="currentProfileAvatar"
      :active-profile-id="profileStore.activeProfileId || null"
      :active-tab-zoom="tabs.find(t => t.id === activeId)?.zoom ?? 1.0"
      @update:address="address = $event"
      @submit-address="onSubmitAddress"
      @back="onBack"
      @forward="onForward"
      @reload="onReload"
      @activate-tab="activateTab"
      @close-tab="closeTab"
      @new-tab="newTab(browserSettings.homeUrl || DEFAULT_BROWSER_URL)"
      @reorder-tab="reorderTab"
      @switch-profile="switchProfile"
      @open-settings="openBrowserSettings"
      @reset-zoom="shortcuts.zoom(0)"
      @tab-context-menu="(e) => handleTabContextMenu(e.tabId, e.clientX, e.clientY)"
    />

    <BrowserBookmarksBar
      v-if="showChrome && !activeInternalPage"
      :on-navigate="navigateActive"
      :on-open-new-tab="(url) => newTab(url)"
    />

    <div ref="contentEl" class="content" :class="{ 'content--internal': !!activeInternalPage }">
      <BrowserSettingsPage
        v-if="activeInternalPage === 'browser-settings'"
        :profile-name="currentProfileName"
        :settings="browserSettings"
        @update:settings="applyBrowserSettings"
        @reset-settings="resetBrowserSettings"
      />
      <BrowserBookmarksPage v-else-if="activeInternalPage === 'browser-bookmarks'" />
      <BrowserDownloadsPage v-else-if="activeInternalPage === 'browser-downloads'" />
      <div v-else-if="activeInternalPage === 'browser-blank'" class="blank-page" />
    </div>

    <div v-if="activeTab?.crashed" class="crash-overlay">
      <div class="crash-message">
        <p>Page crashed</p>
        <button @click="onReload">Reload</button>
      </div>
    </div>

    <BrowserFindBar
      :show-find="showFind"
      :match-count="findMatchCount"
      :active-index="findActiveIndex"
      @close="showFind = false"
      @search="handleFindSearch"
      @next="handleFindNext"
      @prev="handleFindPrev"
    />

    <BrowserBookmarkPopover
      :show="showBookmarkPopover"
      :title="bookmarkData.title"
      :url="bookmarkData.url"
      :favicon="bookmarkData.favicon"
      @close="showBookmarkPopover = false"
      @save="handleBookmarkSaved"
    />

    <!-- Task 36: Keyboard shortcuts help modal (press ? to open) -->
    <BrowserKeyboardHelpModal />
  </div>
</template>

<style scoped>
.shell {
  position: fixed;
  inset: 0;
  display: flex;
  flex-direction: column;
  background: var(--app-background);
  color: var(--app-foreground);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  overflow: hidden;
}

.content {
  position: relative;
  flex: 1;
  min-height: 0;
  background: var(--app-canvas-bg);
}

.content--internal {
  overflow: auto;
}

.blank-page {
  min-height: 100%;
  background: var(--app-canvas-bg);
}

.crash-overlay {
  position: absolute;
  inset: 0;
  background: color-mix(in srgb, var(--app-background) 92%, transparent);
  backdrop-filter: blur(4px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
}

.crash-message {
  text-align: center;
  color: var(--app-foreground);
}

.crash-message p {
  margin: 0 0 16px 0;
  font-size: 18px;
  font-weight: 500;
}

.crash-message button {
  padding: 8px 16px;
  background: var(--app-accent);
  color: var(--app-accent-foreground);
  border: none;
  border-radius: 8px;
  cursor: pointer;
  font-size: 14px;
  transition: filter 0.15s ease;
}

.crash-message button:hover {
  filter: brightness(1.06);
}
</style>
