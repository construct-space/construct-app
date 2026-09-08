# Browser Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the in-app browser feel and function like Chrome: fix target=_blank, add keyboard shortcuts, find-in-page, zoom, devtools, context menus, address-bar suggestions, history, bookmarks, downloads.

**Architecture:** Inject page bridge as Tauri webview initialization script (runs at document-start every navigation, not polled). Extend bridge to emit loading/page-context events. Add Pinia stores for history/bookmarks/downloads. Extract address bar component with suggestions dropdown. Wire native context menus for page and tabs. Persist tab state (pinned, zoom, crash). Add internal pages for bookmarks/history/downloads management.

**Tech Stack:** Vue 3, Tauri 2, Pinia, Vitest, Rust, wry, CSS Custom Highlight API (with `window.find()` fallback).

---

## Phase A: Foundation (Bridge + Popup Fixes)

### Task 1: Rust command to build init script

**Files:**
- Modify: `desktop/src/browser.rs:148-162`
- Modify: `desktop/src/lib.rs:310` (register command)

- [ ] **Step 1: Add command to build init script**

In `desktop/src/browser.rs`, after the existing `build_browser_page_bridge_script` function:

```rust
#[tauri::command]
pub fn browser_build_init_script(
    app: tauri::AppHandle,
    tab_id: String,
    webview_label: String,
) -> Result<String, String> {
    let ipc = build_construct_tauri_ipc_script(&app);
    let bridge = build_browser_page_bridge_script(&tab_id, &webview_label);
    Ok(format!("{}\n{}", ipc, bridge))
}
```

- [ ] **Step 2: Register command in lib.rs**

In `desktop/src/lib.rs`, inside the `tauri::Builder::new(app)` invocation, add to the `.invoke_handler(tauri::generate_handler![...])` list:

```rust
browser::browser_build_init_script,
```

- [ ] **Step 3: Verify command compiles**

```bash
cd /Users/flakerim/Construct/construct-app
bun run operator:build 2>&1 | grep -E 'error|warning' || echo "OK"
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add desktop/src/browser.rs desktop/src/lib.rs
git commit -m "feat(browser): add browser_build_init_script Rust command"
```

---

### Task 2: Wire init script in frontend, remove ensure-bridge timer

**Files:**
- Modify: `frontend/browser/BrowserApp.vue:337-375` (mountWebview function)
- Delete pattern: `BROWSER_ENSURE_PAGE_BRIDGE_EVENT`, `startBridgeTimer`, `clearBridgeTimer`, `tab.bridgeTimer`

- [ ] **Step 1: Remove bridge timer references from BrowserApp.vue**

Find and delete:
- Line with `const BROWSER_ENSURE_PAGE_BRIDGE_EVENT = "browser:ensure-page-bridge";`
- The entire `startBridgeTimer(tab)` function
- The entire `clearBridgeTimer(tab)` function
- All calls to `startBridgeTimer(tab)` and `clearBridgeTimer(tab)` in the file
- The `bridgeTimer: number | null` field in `BrowserTab` type

- [ ] **Step 2: Remove unlistenEnsurePageBridge from bootstrap**

Find and delete in bootstrap:
- `let unlistenEnsurePageBridge: (() => void) | null = null;`
- The `unlistenEnsurePageBridge = await listen(BROWSER_ENSURE_PAGE_BRIDGE_EVENT, ...)` call
- The cleanup `unlistenEnsurePageBridge?.()` and null assignment in `onBeforeUnmount`

- [ ] **Step 3: Fetch init script in mountWebview, pass to Webview constructor**

Replace the `mountWebview` function to build and inject init script:

```typescript
async function mountWebview(tab: BrowserTab) {
  if (tab.url === INTERNAL_BROWSER_SETTINGS_URL || tab.url === INTERNAL_BLANK_URL) {
    await closeWebview(tab);
    return;
  }

  await closeWebview(tab);

  const bounds = await contentBounds();
  const appWindow = getCurrentWindow();
  const label = `tab-${tab.id}-${Date.now()}`;
  tab.label = label;

  try {
    // Fetch init script from Rust
    let initScript = '';
    try {
      initScript = await invoke('browser_build_init_script', {
        tabId: tab.id,
        webviewLabel: label,
      }) as string;
    } catch (error) {
      log(`failed to build init script: ${String(error)}`);
    }

    const webview = new Webview(appWindow, label, {
      url: tab.url,
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
      acceptFirstMouse: true,
      focus: true,
      // Tauri 2 WebviewBuilder supports initialization_script via options
      // If Webview constructor doesn't support it, inject manually after creation via webview.eval
    });

    // Fallback: if init script not injected via options, inject manually
    if (initScript) {
      webview.once('tauri://created', () => {
        void webview.eval(initScript);
        void syncActiveWebview();
        void syncWindowTitle();
        void syncBrowserState();
      });
    } else {
      webview.once('tauri://created', () => {
        void syncActiveWebview();
        void syncWindowTitle();
        void syncBrowserState();
      });
    }

    tab.webview = webview;
    void syncBrowserState();
    webview.once('tauri://error', (event) => {
      log(`webview err: ${JSON.stringify(event.payload)}`);
    });
  } catch (error) {
    log(`mount err: ${String(error)}`);
  }
}
```

- [ ] **Step 4: Test in dev**

```bash
cd /Users/flakerim/Construct/construct-app
bun run dev &
sleep 5
# Open browser, navigate to a site, open devtools console
# Verify no "ensure-page-bridge" listeners running
# Check that bridge script ran (look for window.__CONSTRUCT_BROWSER_BRIDGE__)
```

Expected: console shows `window.__CONSTRUCT_BROWSER_BRIDGE__` is defined.

- [ ] **Step 5: Commit**

```bash
git add frontend/browser/BrowserApp.vue
git commit -m "refactor(browser): inject bridge as init script, remove polling timer"
```

---

### Task 3: Extend page bridge click handler for modifier clicks

**Files:**
- Modify: `desktop/src/browser_page_bridge.js:224-240` (clickHandler function)

- [ ] **Step 1: Replace clickHandler in browser_page_bridge.js**

```javascript
const clickHandler = (event) => {
  if (event.defaultPrevented) return;
  const button = "button" in event ? event.button : 0;
  if (button !== 0 && button !== 1) return; // left or middle only
  const target = event.target instanceof Element
    ? event.target.closest('a[href]')
    : null;
  if (!(target instanceof HTMLAnchorElement)) return;
  const href = target.getAttribute("href") || "";
  const url = resolveUrl(href);
  if (!url || !/^(https?:|about:)/i.test(url)) return;

  const targetAttr = resolvedLinkTarget(target);
  const middle = button === 1;
  const cmdOrCtrl = event.metaKey || event.ctrlKey;
  const shift = event.shiftKey;
  const alt = event.altKey;

  // Force new tab: explicit _blank, middle-click, cmd/ctrl-click
  const explicitBlank = targetAttr === "_blank";
  const modifierNewTab = middle || cmdOrCtrl;

  // Open foreground (active): plain _blank, shift-click, or default cmd-click
  const foreground = explicitBlank || shift || cmdOrCtrl;

  if (!explicitBlank && !modifierNewTab && !shift) return;

  event.preventDefault();
  event.stopPropagation();

  // Emit popup with foreground flag
  const payload = {
    tabId: TAB_ID,
    webviewLabel: WEBVIEW_LABEL,
    url,
    popupId: null,
    target: "_blank",
    via: "target-blank",
    foreground,
  };
  void invokeEvent(POPUP_EVENT, payload);
};
```

- [ ] **Step 2: Verify syntax**

Open `desktop/src/browser_page_bridge.js` and check no syntax errors. Run:

```bash
node -c /Users/flakerim/Construct/construct-app/desktop/src/browser_page_bridge.js
```

Expected: no output (syntax OK).

- [ ] **Step 3: Commit**

```bash
git add desktop/src/browser_page_bridge.js
git commit -m "feat(browser): handle cmd/middle/shift clicks as new-tab signals"
```

---

### Task 4: Add foreground flag to popup payload + handler

**Files:**
- Modify: `frontend/browser/pageBridge.ts:13-20` (BrowserPopupPayload interface)
- Modify: `frontend/browser/BrowserApp.vue:600-639` (handlePopupRequest function)

- [ ] **Step 1: Extend BrowserPopupPayload interface**

In `frontend/browser/pageBridge.ts`:

```typescript
export interface BrowserPopupPayload {
  tabId: string
  webviewLabel: string
  url: string
  popupId: string | null
  target: string | null
  via: 'window.open' | 'target-blank'
  foreground?: boolean
}
```

- [ ] **Step 2: Handle foreground in BrowserApp.vue**

In `handlePopupRequest`, when creating/focusing popup tab, check `payload.foreground`:

```typescript
async function handlePopupRequest(payload: BrowserPopupPayload) {
  const tab = tabById(payload.tabId);
  if (!tab || payload.webviewLabel !== tab.label) return;

  const popupId = `${payload.popupId || ""}`.trim() || null;
  const nextUrl = `${payload.url || ""}`.trim() || INTERNAL_BLANK_URL;
  const foreground = payload.foreground !== false; // default true

  if (popupId) {
    const popupTab = tabById(popupTabIds.get(popupId) ?? null);
    if (!popupTab) {
      await newTab(nextUrl);
      if (foreground && activeId.value) {
        popupTabIds.set(popupId, activeId.value);
      } else if (activeId.value) {
        popupTabIds.set(popupId, activeId.value);
      }
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

    if (foreground) {
      await syncActiveWebview();
    }
    return;
  }

  if (!nextUrl || nextUrl === INTERNAL_BLANK_URL) return;

  if (shouldOpenPopupInNewTab(payload, browserSettings.value.openExternalLinksInNewTab)) {
    await newTab(nextUrl);
    if (!foreground) {
      // Created new tab but don't make it active; switch back to current
      const currentTab = activeId.value;
      if (currentTab !== tabs.value[tabs.value.length - 1]?.id) {
        activeId.value = currentTab || null;
      }
    }
    return;
  }

  activeId.value = tab.id;
  await navigateTab(tab, nextUrl);
  await syncActiveWebview();
}
```

- [ ] **Step 3: Test in dev**

Navigate to a site (e.g., github.com). Middle-click a link → should open in new background tab (not focus). Shift-click a link → should open in foreground.

Expected: middle-click opens tab without switching; shift-click opens and focuses.

- [ ] **Step 4: Commit**

```bash
git add frontend/browser/pageBridge.ts frontend/browser/BrowserApp.vue
git commit -m "feat(browser): handle foreground flag for new tab focus"
```

---

### Task 5: Add loading events to page bridge

**Files:**
- Modify: `desktop/src/browser_page_bridge.js` (add LOADING_EVENT constant and handlers)
- Modify: `frontend/browser/pageBridge.ts` (add event type)

- [ ] **Step 1: Add loading event to pageBridge.ts**

```typescript
export const BROWSER_LOADING_EVENT = 'browser:loading'

export interface BrowserLoadingPayload {
  tabId: string
  webviewLabel: string
  state: 'start' | 'end'
}
```

- [ ] **Step 2: Add loading handlers in browser_page_bridge.js**

After `const POPUP_EVENT = __POPUP_EVENT__;` line, add:

```javascript
const LOADING_EVENT = 'browser:loading';
```

Inside the event listener setup (after line 321 where history.popstate is wired), add:

```javascript
const emitLoading = async (state) => {
  await invokeEvent(LOADING_EVENT, {
    tabId: TAB_ID,
    webviewLabel: WEBVIEW_LABEL,
    state,
  });
};

// Emit loading-start on navigation attempts
document.addEventListener('beforeunload', () => {
  void emitLoading('start');
});

window.addEventListener('beforeunload', () => {
  void emitLoading('start');
});

document.addEventListener('DOMContentLoaded', () => {
  void emitLoading('end');
});

window.addEventListener('load', () => {
  void emitLoading('end');
});
```

Also wrap `window.open` call to emit loading-start:

```javascript
window.open = function (rawUrl, target) {
  const popupId = "popup-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
  const targetHint = typeof target === "string" ? target : null;
  void emitPopup(rawUrl || "", targetHint, "window.open", popupId);
  // Emit start for the new window context
  void emitLoading('start');
  return createPopupProxy(popupId, targetHint);
};
```

- [ ] **Step 3: Test in dev**

Open devtools console, navigate to a different site, watch for loading start/end events in the bridge.

Expected: events fire at appropriate times.

- [ ] **Step 4: Commit**

```bash
git add desktop/src/browser_page_bridge.js frontend/browser/pageBridge.ts
git commit -m "feat(browser): emit loading start/end events from page bridge"
```

---

### Task 6: Wire loading state in BrowserHeader + tab UI

**Files:**
- Modify: `frontend/browser/BrowserApp.vue:55-65` (BrowserTab type)
- Modify: `frontend/browser/BrowserApp.vue:578-598` (handlePageState function)
- Modify: `frontend/browser/BrowserApp.vue:841-855` (event listener setup)
- Modify: `frontend/components/browser/BrowserHeader.vue:506-515` (tab-favicon styles)

- [ ] **Step 1: Add loading field to BrowserTab**

In BrowserApp.vue, update BrowserTab interface:

```typescript
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
```

In each tab creation (newTab function), initialize: `loading: false, pinned: false, crashed: false, zoom: 1.0`.

- [ ] **Step 2: Listen for loading events in BrowserApp.vue bootstrap**

After the existing event listeners, add:

```typescript
unlistenLoading = await listen<BrowserLoadingPayload>(
  BROWSER_LOADING_EVENT,
  (event) => {
    const tab = tabById(event.payload.tabId);
    if (!tab || event.payload.webviewLabel !== tab.label) return;
    tab.loading = event.payload.state === 'start';
  },
);
```

Add `let unlistenLoading: (() => void) | null = null;` to the listener declarations.

In `onBeforeUnmount`, add cleanup: `unlistenLoading?.()`.

- [ ] **Step 3: Update BrowserHeader to show loading spinner**

In BrowserHeader.vue, replace the tab-favicon rendering:

```vue
<span class="tab-favicon" :class="{ 'tab-favicon--fallback': !tab.favicon, 'tab-favicon--loading': tab.loading }">
  <img v-if="tab.favicon && !tab.loading" :src="tab.favicon" alt="" />
  <span v-else-if="!tab.loading">{{ (tab.title || "N").slice(0, 1).toUpperCase() }}</span>
  <span v-else class="tab-favicon__spinner"></span>
</span>
```

Add CSS for spinner:

```css
.tab-favicon__spinner {
  display: inline-block;
  width: 10px;
  height: 10px;
  border: 2px solid rgba(255, 255, 255, 0.3);
  border-top-color: #f2f3f7;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}
```

- [ ] **Step 4: Add progress bar to address bar**

In BrowserHeader.vue chrome section, after the address-form div:

```vue
<div v-if="activeTab?.loading" class="addr-progress"></div>
```

Add CSS:

```css
.addr-progress {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  height: 3px;
  background: linear-gradient(90deg, #6b8afd 0%, #3ec8a4 100%);
  animation: progress 1.5s ease-in-out infinite;
}

@keyframes progress {
  0% { width: 0%; }
  50% { width: 80%; }
  100% { width: 100%; }
}
```

- [ ] **Step 5: Test in dev**

Navigate to a slow site. Watch the spinner appear in the tab favicon and progress bar show in address bar.

Expected: spinner animates, progress bar appears during load.

- [ ] **Step 6: Commit**

```bash
git add frontend/browser/BrowserApp.vue frontend/components/browser/BrowserHeader.vue
git commit -m "feat(browser): add loading state and progress indicators"
```

---

## Phase B: Keyboard Shortcuts

### Task 7: Create useBrowserShortcuts composable + tests

**Files:**
- Create: `frontend/browser/composables/useBrowserShortcuts.ts`
- Create: `frontend/browser/shortcuts.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// frontend/browser/shortcuts.test.ts
import { describe, it, expect, vi } from 'vitest'
import { useBrowserShortcuts } from './composables/useBrowserShortcuts'

describe('useBrowserShortcuts', () => {
  it('triggers newTab on Cmd+T (macOS)', () => {
    const handlers = {
      newTab: vi.fn(),
      closeTab: vi.fn(),
      reopenClosed: vi.fn(),
      focusAddress: vi.fn(),
      reload: vi.fn(),
      back: vi.fn(),
      forward: vi.fn(),
      jumpTab: vi.fn(),
      nextTab: vi.fn(),
      prevTab: vi.fn(),
      zoom: vi.fn(),
      toggleFind: vi.fn(),
      toggleDevtools: vi.fn(),
      bookmarkCurrent: vi.fn(),
      openDownloads: vi.fn(),
    }

    const { dispose } = useBrowserShortcuts(handlers)

    const event = new KeyboardEvent('keydown', {
      key: 't',
      metaKey: true,
      bubbles: true,
    })
    window.dispatchEvent(event)

    expect(handlers.newTab).toHaveBeenCalled()
    dispose()
  })

  it('ignores shortcuts when input is focused', () => {
    const handlers = {
      newTab: vi.fn(),
      closeTab: vi.fn(),
      reopenClosed: vi.fn(),
      focusAddress: vi.fn(),
      reload: vi.fn(),
      back: vi.fn(),
      forward: vi.fn(),
      jumpTab: vi.fn(),
      nextTab: vi.fn(),
      prevTab: vi.fn(),
      zoom: vi.fn(),
      toggleFind: vi.fn(),
      toggleDevtools: vi.fn(),
      bookmarkCurrent: vi.fn(),
      openDownloads: vi.fn(),
    }

    const { dispose } = useBrowserShortcuts(handlers)

    const input = document.createElement('input')
    input.focus()
    document.body.appendChild(input)

    const event = new KeyboardEvent('keydown', {
      key: 't',
      metaKey: true,
      bubbles: true,
    })
    window.dispatchEvent(event)

    expect(handlers.newTab).not.toHaveBeenCalled()

    dispose()
    document.body.removeChild(input)
  })

  it('allows Cmd+L even when input is focused', () => {
    const handlers = {
      newTab: vi.fn(),
      closeTab: vi.fn(),
      reopenClosed: vi.fn(),
      focusAddress: vi.fn(),
      reload: vi.fn(),
      back: vi.fn(),
      forward: vi.fn(),
      jumpTab: vi.fn(),
      nextTab: vi.fn(),
      prevTab: vi.fn(),
      zoom: vi.fn(),
      toggleFind: vi.fn(),
      toggleDevtools: vi.fn(),
      bookmarkCurrent: vi.fn(),
      openDownloads: vi.fn(),
    }

    const { dispose } = useBrowserShortcuts(handlers)

    const input = document.createElement('input')
    input.focus()
    document.body.appendChild(input)

    const event = new KeyboardEvent('keydown', {
      key: 'l',
      metaKey: true,
      bubbles: true,
    })
    window.dispatchEvent(event)

    expect(handlers.focusAddress).toHaveBeenCalled()

    dispose()
    document.body.removeChild(input)
  })

  it('maps Ctrl to Cmd on non-macOS', () => {
    // This test mocks navigator.platform
    const originalPlatform = Object.getOwnPropertyDescriptor(navigator, 'platform')
    Object.defineProperty(navigator, 'platform', {
      value: 'Linux x86_64',
      configurable: true,
    })

    const handlers = {
      newTab: vi.fn(),
      closeTab: vi.fn(),
      reopenClosed: vi.fn(),
      focusAddress: vi.fn(),
      reload: vi.fn(),
      back: vi.fn(),
      forward: vi.fn(),
      jumpTab: vi.fn(),
      nextTab: vi.fn(),
      prevTab: vi.fn(),
      zoom: vi.fn(),
      toggleFind: vi.fn(),
      toggleDevtools: vi.fn(),
      bookmarkCurrent: vi.fn(),
      openDownloads: vi.fn(),
    }

    const { dispose } = useBrowserShortcuts(handlers)

    const event = new KeyboardEvent('keydown', {
      key: 't',
      ctrlKey: true,
      bubbles: true,
    })
    window.dispatchEvent(event)

    expect(handlers.newTab).toHaveBeenCalled()

    dispose()
    if (originalPlatform) {
      Object.defineProperty(navigator, 'platform', originalPlatform)
    }
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /Users/flakerim/Construct/construct-app
bun run test -- frontend/browser/shortcuts.test.ts
```

Expected: FAIL (useBrowserShortcuts not defined)

- [ ] **Step 3: Write useBrowserShortcuts composable**

```typescript
// frontend/browser/composables/useBrowserShortcuts.ts
import { onMounted, onBeforeUnmount } from 'vue'

export interface BrowserShortcutHandlers {
  newTab: () => void
  closeTab: () => void
  reopenClosed: () => void
  focusAddress: () => void
  reload: (hard: boolean) => void
  back: () => void
  forward: () => void
  jumpTab: (n: number) => void
  nextTab: () => void
  prevTab: () => void
  zoom: (delta: -1 | 0 | 1) => void
  toggleFind: () => void
  toggleDevtools: () => void
  bookmarkCurrent: () => void
  openDownloads: () => void
}

function isMacOS(): boolean {
  return navigator.platform.toLowerCase().includes('mac')
}

function isEditableElement(el: Element | null): boolean {
  if (!el) return false
  const tag = el.tagName.toLowerCase()
  if (tag === 'input' || tag === 'textarea') return true
  if (el.contentEditable === 'true') return true
  return false
}

export function useBrowserShortcuts(handlers: BrowserShortcutHandlers) {
  const isMac = isMacOS()

  const handleKeyDown = (event: KeyboardEvent) => {
    const target = event.target as Element | null
    const isEditable = isEditableElement(target)

    // Modifier check: use metaKey on Mac, ctrlKey on others
    const isMod = isMac ? event.metaKey : event.ctrlKey
    const isShift = event.shiftKey
    const isAlt = event.altKey

    // Allow focusAddress (L, E) even when editable
    if ((event.key.toLowerCase() === 'l' || event.key.toLowerCase() === 'e') && isMod) {
      event.preventDefault()
      handlers.focusAddress()
      return
    }

    // Allow closeTab (W) even when editable
    if (event.key.toLowerCase() === 'w' && isMod) {
      event.preventDefault()
      handlers.closeTab()
      return
    }

    // Ignore other shortcuts when editable
    if (isEditable) return

    // Shortcut map
    const key = event.key.toLowerCase()

    if (key === 't' && isMod) {
      event.preventDefault()
      handlers.newTab()
    } else if (key === 'w' && isMod) {
      event.preventDefault()
      handlers.closeTab()
    } else if (key === 't' && isMod && isShift) {
      event.preventDefault()
      handlers.reopenClosed()
    } else if (key === 'r' && isMod) {
      event.preventDefault()
      handlers.reload(false)
    } else if (key === 'r' && isMod && isShift) {
      event.preventDefault()
      handlers.reload(true)
    } else if ((key === '[' || key === 'arrowleft') && isMod) {
      event.preventDefault()
      handlers.back()
    } else if ((key === ']' || key === 'arrowright') && isMod) {
      event.preventDefault()
      handlers.forward()
    } else if (key >= '1' && key <= '8' && isMod) {
      event.preventDefault()
      handlers.jumpTab(parseInt(key, 10))
    } else if (key === '9' && isMod) {
      event.preventDefault()
      handlers.jumpTab(-1)
    } else if ((key === ']' && isMod && isShift) || (key === 'tab' && event.ctrlKey && isShift)) {
      event.preventDefault()
      handlers.nextTab()
    } else if ((key === '[' && isMod && isShift) || (key === 'tab' && event.ctrlKey && !isShift)) {
      event.preventDefault()
      handlers.prevTab()
    } else if ((key === '=' || key === '+') && isMod) {
      event.preventDefault()
      handlers.zoom(1)
    } else if (key === '-' && isMod) {
      event.preventDefault()
      handlers.zoom(-1)
    } else if (key === '0' && isMod) {
      event.preventDefault()
      handlers.zoom(0)
    } else if (key === 'f' && isMod) {
      event.preventDefault()
      handlers.toggleFind()
    } else if ((key === 'i' && isMod && isAlt) || key === 'f12') {
      event.preventDefault()
      handlers.toggleDevtools()
    } else if (key === 'd' && isMod) {
      event.preventDefault()
      handlers.bookmarkCurrent()
    } else if (key === 'j' && isMod && isShift) {
      event.preventDefault()
      handlers.openDownloads()
    }
  }

  onMounted(() => {
    window.addEventListener('keydown', handleKeyDown)
  })

  onBeforeUnmount(() => {
    window.removeEventListener('keydown', handleKeyDown)
  })

  return {
    dispose: () => {
      window.removeEventListener('keydown', handleKeyDown)
    },
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
bun run test -- frontend/browser/shortcuts.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/browser/composables/useBrowserShortcuts.ts frontend/browser/shortcuts.test.ts
git commit -m "feat(browser): add useBrowserShortcuts composable with full shortcut map"
```

---

### Task 8: Create useTabSession (closed tabs stack)

**Files:**
- Create: `frontend/browser/composables/useTabSession.ts`
- Create: `frontend/browser/tabSession.test.ts`

- [ ] **Step 1: Write test**

```typescript
// frontend/browser/tabSession.test.ts
import { describe, it, expect } from 'vitest'
import { useTabSession } from './composables/useTabSession'

describe('useTabSession', () => {
  it('pushes closed tab to stack', () => {
    const session = useTabSession()
    session.pushClosed({ url: 'https://example.com', title: 'Example' })
    expect(session.canReopen()).toBe(true)
  })

  it('pops most recent closed tab', () => {
    const session = useTabSession()
    session.pushClosed({ url: 'https://example.com', title: 'Example' })
    session.pushClosed({ url: 'https://google.com', title: 'Google' })
    const restored = session.popClosed()
    expect(restored?.url).toBe('https://google.com')
  })

  it('caps stack at 10 entries', () => {
    const session = useTabSession()
    for (let i = 0; i < 15; i++) {
      session.pushClosed({ url: `https://site${i}.com`, title: `Site ${i}` })
    }
    // Pop 10, should get the last 10 (5-14)
    const urls = []
    for (let i = 0; i < 10; i++) {
      const tab = session.popClosed()
      if (tab) urls.push(tab.url)
    }
    expect(urls.length).toBe(10)
    expect(urls[0]).toBe('https://site14.com')
  })

  it('clears stack', () => {
    const session = useTabSession()
    session.pushClosed({ url: 'https://example.com', title: 'Example' })
    session.clear()
    expect(session.canReopen()).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
bun run test -- frontend/browser/tabSession.test.ts
```

Expected: FAIL

- [ ] **Step 3: Write composable**

```typescript
// frontend/browser/composables/useTabSession.ts
import { ref, computed } from 'vue'

export interface ClosedTabEntry {
  url: string
  title: string
}

export function useTabSession() {
  const closedTabs = ref<ClosedTabEntry[]>([])
  const MAX_CLOSED = 10

  function pushClosed(tab: ClosedTabEntry) {
    closedTabs.value.unshift(tab)
    if (closedTabs.value.length > MAX_CLOSED) {
      closedTabs.value = closedTabs.value.slice(0, MAX_CLOSED)
    }
  }

  function popClosed(): ClosedTabEntry | null {
    return closedTabs.value.shift() || null
  }

  function canReopen(): boolean {
    return closedTabs.value.length > 0
  }

  function clear() {
    closedTabs.value = []
  }

  return {
    closedTabs: computed(() => closedTabs.value),
    pushClosed,
    popClosed,
    canReopen,
    clear,
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
bun run test -- frontend/browser/tabSession.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/browser/composables/useTabSession.ts frontend/browser/tabSession.test.ts
git commit -m "feat(browser): add useTabSession for reopening closed tabs"
```

---

### Task 9: Wire shortcuts + closed-tabs in BrowserApp

**Files:**
- Modify: `frontend/browser/BrowserApp.vue` (main section, shortcuts + session integration)

- [ ] **Step 1: Import composables**

At the top of BrowserApp.vue script, after other imports:

```typescript
import { useBrowserShortcuts } from '@/browser/composables/useBrowserShortcuts'
import { useTabSession } from '@/browser/composables/useTabSession'
```

- [ ] **Step 2: Add session and shortcut setup in script**

After `const profileStore = useProfileStore();`:

```typescript
const tabSession = useTabSession()

const shortcuts = useBrowserShortcuts({
  newTab: () => {
    void newTab(browserSettings.value.homeUrl || DEFAULT_BROWSER_URL)
  },
  closeTab: () => {
    if (activeTab.value) {
      void closeTab(activeTab.value.id)
    }
  },
  reopenClosed: () => {
    const closed = tabSession.popClosed()
    if (closed) {
      void newTab(closed.url)
    }
  },
  focusAddress: () => {
    headerRef.value?.focusAddressBar(true)
  },
  reload: (hard) => {
    void onReload()
  },
  back: () => {
    onBack()
  },
  forward: () => {
    onForward()
  },
  jumpTab: (n) => {
    if (n === -1) {
      // Last tab
      const last = tabs.value[tabs.value.length - 1]
      if (last) void activateTab(last.id)
    } else if (n >= 1 && n <= 8) {
      const tab = tabs.value[n - 1]
      if (tab) void activateTab(tab.id)
    }
  },
  nextTab: () => {
    if (!activeTab.value) return
    const idx = tabs.value.findIndex((t) => t.id === activeTab.value?.id)
    if (idx >= 0 && idx < tabs.value.length - 1) {
      void activateTab(tabs.value[idx + 1].id)
    }
  },
  prevTab: () => {
    if (!activeTab.value) return
    const idx = tabs.value.findIndex((t) => t.id === activeTab.value?.id)
    if (idx > 0) {
      void activateTab(tabs.value[idx - 1].id)
    }
  },
  zoom: (delta) => {
    if (!activeTab.value) return
    if (delta === 0) {
      activeTab.value.zoom = 1
    } else {
      activeTab.value.zoom = Math.max(0.5, Math.min(2, activeTab.value.zoom + delta * 0.1))
    }
    void invoke('browser_set_zoom', { webviewLabel: activeTab.value.label || '', factor: activeTab.value.zoom })
  },
  toggleFind: () => {
    // Placeholder, wired in Task 16
  },
  toggleDevtools: () => {
    if (activeTab.value?.label) {
      void invoke('browser_devtools_toggle', { webviewLabel: activeTab.value.label })
    }
  },
  bookmarkCurrent: () => {
    // Placeholder, wired in Task 28
  },
  openDownloads: () => {
    void newTab(INTERNAL_DOWNLOADS_URL)
  },
})
```

- [ ] **Step 3: Update closeTab to track closed tab**

Find the `closeTab` function and modify it:

```typescript
async function closeTab(id: string) {
  if (isSingleTabMode.value && tabs.value.length <= 1) return

  const index = tabs.value.findIndex((tab) => tab.id === id)
  if (index < 0) return

  const [tab] = tabs.value.splice(index, 1)
  
  // Record in session before closing webview
  if (tab.url !== INTERNAL_BROWSER_SETTINGS_URL && tab.url !== INTERNAL_BLANK_URL) {
    tabSession.pushClosed({ url: tab.url, title: tab.title })
  }
  
  await closeWebview(tab)
  // ... rest of closeTab
}
```

- [ ] **Step 4: Test in dev**

Press ⌘T → new tab. Press ⌘W → close. Press ⌘⇧T → reopen. Press ⌘1 → jump to first tab.

Expected: all shortcuts work.

- [ ] **Step 5: Commit**

```bash
git add frontend/browser/BrowserApp.vue
git commit -m "feat(browser): wire keyboard shortcuts and closed-tab reopening"
```

---

## Phase C: Zoom + DevTools (abbreviated for space)

### Task 10: Rust browser_set_zoom command

**Files:**
- Modify: `desktop/src/browser.rs` (add command)
- Modify: `desktop/src/lib.rs` (register)

- [ ] **Step 1: Add command**

```rust
#[tauri::command]
pub fn browser_set_zoom(
    app: tauri::AppHandle,
    webview_label: String,
    factor: f64,
) -> Result<(), String> {
    let label = webview_label.trim();
    if label.is_empty() {
        return Err("webview_label is required".to_string());
    }

    let webview = app
        .get_webview(label)
        .ok_or_else(|| format!("webview not found: {}", label))?;

    webview
        .set_zoom(factor)
        .map_err(|err| format!("failed to set zoom: {}", err))
}
```

- [ ] **Step 2: Register in lib.rs and test build**

Add to invoke_handler list: `browser::browser_set_zoom,`

```bash
bun run operator:build
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add desktop/src/browser.rs desktop/src/lib.rs
git commit -m "feat(browser): add browser_set_zoom Rust command"
```

---

### Task 11: Zoom UI + per-tab zoom + settings persistence

**Files:**
- Modify: `frontend/browser/settings.ts` (add zoomByOrigin)
- Modify: `frontend/browser/BrowserApp.vue` (handle zoom, apply on load)
- Modify: `frontend/components/browser/BrowserHeader.vue` (show zoom chip)

(Details abbreviated — follow pattern from Task 6 for loading state. Wire zoom in address bar, store per-origin in `BrowserSettings.zoomByOrigin: Record<string, number>`, apply on tab activate and page state change.)

- [ ] **Test:** Navigate site → ⌘+ several times → zoom % chip shows → reload → zoom persists.

- [ ] **Commit**

```bash
git add frontend/browser/settings.ts frontend/browser/BrowserApp.vue frontend/components/browser/BrowserHeader.vue
git commit -m "feat(browser): per-tab zoom with origin-based persistence"
```

---

### Task 12-13: DevTools toggle (abbreviated)

(Add guard `#[cfg(any(debug_assertions, feature = "devtools"))]` to toggle command. Wire ⌘⌥I / F12.)

---

## Phase D: Find in Page (abbreviated)

### Task 14: findController.ts + tests

**Files:**
- Create: `frontend/browser/findController.ts`
- Create: `frontend/browser/findController.test.ts`

(Build script that injects CSS Highlight API + find handlers. Test: script builds with escaping, highlights match count reported.)

- [ ] **Commit**

```bash
git add frontend/browser/findController.ts frontend/browser/findController.test.ts
git commit -m "feat(browser): create findController for find-in-page highlighting"
```

---

### Task 15-16: Find bar UI + Rust command (abbreviated)

(BrowserFindBar.vue, browser_find command in Rust, wire ⌘F.)

---

## Phase E-L: Remaining Components (abbreviated tasks list)

Due to length, remaining phases summarized:

**Phase E: Context Menus**
- Task 17: Extend bridge with `BROWSER_PAGE_CONTEXT_EVENT`
- Task 18: Page context menu handler in BrowserApp
- Task 19: Tab context menu emit + handler in BrowserHeader

**Phase F: Pinned Tabs + Crash**
- Task 20: Add `pinned` field, persist, UI rendering, drag constraints
- Task 21: Crash state + overlay

**Phase G: History**
- Task 22: browserHistory Pinia store (CRUD, query, cap 5000)
- Task 23: Debounced recording in handlePageState

**Phase H: Address Bar**
- Task 24: Extract BrowserAddressBar component from BrowserHeader
- Task 25: BrowserSuggestionsDropdown + ranking
- Task 26: Hide webview height during suggestions or use alternate approach

**Phase I: Bookmarks**
- Task 27: browserBookmarks store + folders
- Task 28: BookmarkPopover + ⌘D wiring
- Task 29: BrowserBookmarksBar + right-click menu
- Task 30: about:bookmarks manager page

**Phase J: Downloads**
- Task 31: Rust download handlers + emit events
- Task 32: browserDownloads store
- Task 33: BrowserDownloadsBar + reveal in finder
- Task 34: about:downloads page

**Phase K: History View + Clear**
- Task 35: about:history page + search
- Task 36: browser_clear_data Rust command + modal

**Phase L: Settings**
- Task 37: BrowserSettingsPage extensions (saveHistory toggle, showBookmarksBar, etc.)

**Phase M: Acceptance**
- Task 38: Manual test checklist (5 representative sites for target=_blank, all shortcuts, find, zoom, devtools, menus, bookmarks, history, downloads)

---

## Execution Notes

- Each task ends with a commit — no batching.
- Rust commands compiled with `bun run operator:build` before frontend tests (Tauri FFI).
- Frontend tests via `bun run test -- <path>`.
- Manual testing in dev via `bun run dev`.
- Caveman mode in chat; plan doc is normal English for clarity.

---

## Risk Mitigations

- **init-script option on Webview:** If `WebviewBuilder::initialization_script` unavailable in `Webview` JS constructor, expose Rust command `browser_create_tab_webview(...)` wrapping builder.
- **z-index (address bar dropdown, find bar):** Shrink active webview height while UI open instead of overlaying.
- **CSS Highlight API (macOS WKWebView):** Test on Safari 17.2+. Fallback to `window.find()`.
- **Download handler closures:** Ensure all closures are `Send + Sync`, use `AppHandle` clones.

---

End of plan. Ready for subagent-driven execution.
