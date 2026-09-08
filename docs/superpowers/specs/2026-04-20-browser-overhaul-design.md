# Browser Overhaul — Design

**Date:** 2026-04-20
**Scope:** `frontend/browser/`, `frontend/components/browser/`, `desktop/src/browser*`, `desktop/src/browser_page_bridge.js`
**Goal:** Make the in-app browser feel like Chrome (functionality, not visual design). Fix `target="_blank"` regression. Add keyboard shortcuts, find-in-page, zoom, devtools, context menus, address-bar suggestions, history, bookmarks, downloads.

---

## 1. Background

The in-app browser is a Tauri 2 webview overlay (`frontend/browser/BrowserApp.vue`) per tab, positioned over a Vue chrome. A page bridge (`desktop/src/browser_page_bridge.js`) is currently injected by the host every 1.5s via `webview.eval` to capture `window.open`, `target=_blank` clicks, GET-form submissions, link context menus, and to emit page state (url, title, favicon).

### Symptoms

- `target="_blank"` links frequently do nothing (no new tab opens).
- Modifier-clicks (cmd/middle/shift) on links never open new tabs.
- No keyboard shortcuts (cmd+T, cmd+W, cmd+L, cmd+R, cmd+1–9, cmd+F, cmd+±0, cmd+opt+I).
- No loading indicator per tab.
- No find-in-page.
- No zoom controls.
- No devtools toggle.
- No address-bar suggestions / history.
- No bookmarks, no downloads UI, no history view.
- Right-click on tab does nothing; right-click on page only handles links.

### Root cause for `_blank`

The bridge is eval'd post-load via a 1.5s polling timer. During the race window after a navigation:

1. The page's own JS may run, register handlers, and consume click events before our `clickHandler` is registered (we use `capture=true`, but pages can `stopImmediatePropagation` from earlier capture-phase listeners on document).
2. WebKit/WebView2 native behavior for unhandled `_blank` is to swallow or open externally — we never see it.
3. The current `clickHandler` early-returns on any modifier (`event.metaKey || ctrlKey || shiftKey || altKey`), so cmd/middle-click never reach `emitPopup`.

Fix: inject the bridge as the webview's `initialization_script` so it runs at document-start on every navigation, before any page script. Extend the click handler to treat modifier clicks and middle clicks as new-tab signals.

---

## 2. Phased shape (delivered as one effort)

The user opted to ship all sections together (Plan A). Sections below are organized for clarity but land in a single feature branch.

---

## 3. Section 1 — Foundation (popup + injection)

### 3.1 Bridge injection model

**Remove:**
- `BROWSER_ENSURE_PAGE_BRIDGE_EVENT` listener in `desktop/src/browser.rs::install_event_listeners`.
- `startBridgeTimer` / `clearBridgeTimer` / `tab.bridgeTimer` field in `frontend/browser/BrowserApp.vue`.
- The `webview.eval(script)` call inside the listener.

**Replace:**
- In `desktop/src/browser.rs`, the host opens child webviews via `frontend/browser/BrowserApp.vue` calling `new Webview(appWindow, label, options)`. The `WebviewOptions` (Tauri 2) supports `initializationScript: string`. Add it.
- Frontend builds the script identical to the current `build_browser_page_bridge_script` output (concatenation of `construct_ipc.js` + `browser_page_bridge.js` with placeholders replaced). To avoid duplicating the JS in TS, expose a Rust command `browser_build_init_script(tabId, label) -> String` and call it from `BrowserApp.vue::mountWebview` before constructing the webview.
- The bridge's `BRIDGE_KEY` guard already prevents double-install on programmatic re-eval; keep it (handles SPA navigations that don't reset `window`).

### 3.2 Click handler extensions

Edit `desktop/src/browser_page_bridge.js::clickHandler`:

```js
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

  // Conditions that force a new tab
  const explicitBlank = targetAttr === "_blank";
  const modifierNewTab = middle || cmdOrCtrl;
  const modifierForeground = shift; // shift = open and focus

  if (!explicitBlank && !modifierNewTab && !modifierForeground) return;

  event.preventDefault();
  event.stopPropagation();
  void emitPopup(url, "_blank", "target-blank", null, {
    foreground: explicitBlank ? true : (modifierForeground || !middle),
  });
};
```

Extend `BrowserPopupPayload` with optional `foreground?: boolean` (default true). In `BrowserApp.vue::handlePopupRequest`, when `foreground === false`, create the new tab without `activeId` switch.

### 3.3 Native fallback

Add `wry`-level guard in Rust by calling `WebviewBuilder::on_navigation(|url| { /* allow */ true })` and a future `on_new_window_requested` if/when Tauri exposes it. For now the init-script bridge is sufficient on macOS WKWebView and Windows WebView2; the Rust hook is a stub for later coverage.

### 3.4 Loading state

Add `loading: boolean` to `BrowserTab` in `BrowserApp.vue`.

In `browser_page_bridge.js`, emit:
- `BROWSER_LOADING_EVENT` with `{tabId, webviewLabel, state: 'start' | 'end'}`.
- `start` on `beforeunload` and on `window.open`/`location.assign` calls before navigation.
- `end` on `DOMContentLoaded` and `load`.

`BrowserHeader.vue` swaps favicon `<img>` for a small spinning ring when `tab.loading === true`. Address bar shows a thin progress bar (CSS keyframe, indeterminate) along its bottom border while loading.

---

## 4. Section 2 — Keyboard shortcuts

New file: `frontend/browser/composables/useBrowserShortcuts.ts`.

```ts
export function useBrowserShortcuts(handlers: {
  newTab: () => void;
  closeTab: () => void;
  reopenClosed: () => void;
  focusAddress: () => void;
  reload: (hard: boolean) => void;
  back: () => void;
  forward: () => void;
  jumpTab: (n: number) => void;
  nextTab: () => void;
  prevTab: () => void;
  zoom: (delta: -1 | 0 | 1) => void;
  toggleFind: () => void;
  toggleDevtools: () => void;
  bookmarkCurrent: () => void;
  openDownloads: () => void;
}): { dispose: () => void };
```

| Combo | Action |
|---|---|
| ⌘T | newTab |
| ⌘W | closeTab |
| ⌘⇧T | reopenClosed |
| ⌘L / ⌘E | focusAddress |
| ⌘R | reload(false) |
| ⌘⇧R | reload(true) |
| ⌘[ / ⌘← | back |
| ⌘] / ⌘→ | forward |
| ⌘1…⌘8 | jumpTab(n) |
| ⌘9 | jumpTab(-1) (last) |
| ⌘⇧] / ⌘⌥→ / Ctrl+Tab | nextTab |
| ⌘⇧[ / ⌘⌥← / Ctrl+⇧+Tab | prevTab |
| ⌘= / ⌘+ | zoom(+1) |
| ⌘- | zoom(-1) |
| ⌘0 | zoom(0) |
| ⌘F | toggleFind |
| ⌘⌥I / F12 | toggleDevtools |
| ⌘D | bookmarkCurrent |
| ⌘⇧J | openDownloads |

Cross-platform: use `event.metaKey` on macOS, `event.ctrlKey` elsewhere — composable detects via `navigator.platform`.

Ignore key events when the active element is `INPUT`, `TEXTAREA`, or `[contenteditable]`, except for ⌘L/⌘E (always wins) and ⌘W (closes tab even when address-bar focused).

Closed-tabs stack lives in `useTabSession.ts` (LRU, cap 10).

---

## 5. Section 3 — Find / Zoom / DevTools

### 5.1 Find in page

New `frontend/components/browser/BrowserFindBar.vue`:
- Slides in from the top-right of the content area, ~360px wide, fixed.
- Inputs: query, ↑ prev, ↓ next, "x of y", close.
- Esc closes; Enter = next; ⇧Enter = prev.

New `frontend/browser/findController.ts` builds a per-webview script:
- Uses CSS Custom Highlight API (`new Highlight(...)`, `CSS.highlights.set('browser-find', highlight)`) with a `::highlight(browser-find)` rule.
- Scrolls match into view via `Range.getBoundingClientRect()` + `scrollIntoView`.
- Falls back to `window.find()` on engines without Highlight API.
- Posts `{current, total}` back to host via existing IPC.

Host side: `BrowserApp.vue` exposes `find(query, dir)` that invokes Rust command `browser_find(label, query, dir)` which evals the script with the query.

### 5.2 Zoom

- New per-tab `zoom: number` (default 1.0). UI: ⌘+/-/0 and inline chip.
- Persist last-used zoom per origin in `BrowserSettings.zoomByOrigin: Record<string, number>`.
- Apply via Rust command `browser_set_zoom(label, factor)` calling `webview.set_zoom(factor)` (Tauri 2 API).
- Reapply on tab activate and on each `handlePageState` when origin changes.
- Address-bar shows `100%` / `125%` chip when ≠ 1.0; click → reset.

### 5.3 DevTools

- Rust command `browser_devtools_toggle(label)`. Behind `#[cfg(any(debug_assertions, feature = "devtools"))]`.
- Calls `webview.open_devtools()` / `is_devtools_open()` / `close_devtools()`.
- ⌘⌥I and F12 trigger via shortcuts composable.

---

## 6. Section 4 — Context menus + tab UX

### 6.1 Page context menu

Extend `contextMenuHandler` in `browser_page_bridge.js` to fire even when not on an anchor. New event `BROWSER_PAGE_CONTEXT_EVENT` payload:

```ts
{
  tabId, webviewLabel,
  clientX, clientY,
  linkUrl: string | null,
  selectionText: string | null,
  imageUrl: string | null,
  pageUrl: string,
}
```

Host (`BrowserApp.vue`) builds a menu via `useNativeContextMenu` with grouped items:
- Link present: Open in New Tab / Open in New Window / Copy Link / Save Link As
- Image present: Open Image in New Tab / Copy Image / Save Image As
- Selection present: Copy / Search "<engine>" for "<text>" / (mac) Speak
- Always: Back / Forward / Reload / Save As / Print / View Source / Inspect

"View Source" navigates current tab to `view-source:<url>`. "Inspect" opens devtools (debug builds).

### 6.2 Tab context menu

`BrowserHeader.vue` adds `@contextmenu` on `.tab` → emits `context-tab` with `{id, x, y}`.

`BrowserApp.vue` shows native menu:
- New Tab to the Right
- Reload
- Duplicate
- Pin / Unpin
- Close
- Close Other Tabs
- Close Tabs to the Right
- Reopen Closed Tab

### 6.3 Pinned tabs

Add `pinned: boolean` to `BrowserTab`. Pinned tabs:
- Render as 36px icon-only chip.
- Sort first; drag-reorder is constrained to within their group (pinned ↔ pinned, unpinned ↔ unpinned).
- ⌘W is a no-op when active tab is pinned (use ⌘⇧W to override — uncommon, deferred).
- Persist pin state in `construct:browser:pinned-tabs:v1` so restart re-pins them.

### 6.4 Crash placeholder

When a webview emits `tauri://error`, mark `tab.crashed = true`. Render a "This page crashed. [Reload]" overlay in `BrowserApp.vue` content area.

---

## 7. Section 5 — Address bar (suggestions + history)

### 7.1 Component split

Extract address bar from `BrowserHeader.vue`:
- New `frontend/components/browser/BrowserAddressBar.vue` — input + chip slots (zoom, security indicator, bookmark star).
- New `frontend/components/browser/BrowserSuggestionsDropdown.vue` — anchored dropdown.

`BrowserHeader.vue` keeps tabs row, nav buttons, profile chip; passes through props/emits.

### 7.2 Suggestions

Sources, in order, deduped by url, max 8:

1. Top-site: highest `visitCount` matching host or origin of query
2. History — title contains query (case-insensitive)
3. History — url contains query
4. Search fallback row: `Search <engine> for "<query>"` (always last unless query is a clean URL)

Keyboard: ↑/↓ navigate, Enter commits selection (or current input if none), Esc closes, Tab accepts highlighted url into input.

Each row: 16x16 favicon + title (1 line, ellipsis) + dim url (1 line, ellipsis).

### 7.3 History store

New `frontend/browser/stores/browserHistory.ts` (Pinia):

```ts
interface HistoryEntry {
  url: string;
  title: string;
  favicon: string | null;
  visitCount: number;
  lastVisited: number; // ms epoch
}
```

- Persist via `profileStorage.setItem('construct:browser:history:v1', JSON.stringify(entries))`.
- Cap 5000; evict by oldest `lastVisited` when over.
- Recorded in `BrowserApp.vue::handlePageState` (existing path) — debounced 500ms per tab to avoid spamming on SPA route churn.
- API: `query(text, limit) → HistoryEntry[]` (ranked), `add(entry)`, `clear()`, `remove(url)`, `topSites(limit)`.

### 7.4 Privacy toggle

`BrowserSettings.saveHistory: boolean` (default `true`). When `false`:
- `add()` is a no-op.
- Existing entries remain (separate "Clear browsing data" button removes them).

`BrowserSettingsPage.vue` gains the toggle row.

---

## 8. Section 6 — Persistence (downloads, bookmarks, history view)

### 8.1 Downloads

Wire wry's `download_started_handler` and `download_completed_handler` in Rust webview construction.

```rust
.with_download_handler(|_url, target| {
    // accept all; suggest default dir
    *target = downloads_dir().join(target.file_name());
    true
})
.with_download_completed_handler(|url, path, success| {
    emit("browser:download", DownloadEvent { url, path, success, .. });
})
```

Events to host: `browser:download` `{id, url, filename, totalBytes, receivedBytes, state: 'in-progress'|'complete'|'failed', path}`.

`useDownloads.ts` composable + `browserDownloads` Pinia store, persisted at `construct:browser:downloads:v1` (cap 200 completed, in-progress kept until terminal).

UI:
- `BrowserDownloadsBar.vue` — bottom strip, slides up on first download, auto-hides 5s after last completion. Shows up to 5 active.
- Click filename → reveal in Finder via Tauri `revealItemInDir`.
- ⌘⇧J opens `about:downloads` internal page (`BrowserDownloadsPage.vue`) — full list, search, clear, re-download.

### 8.2 Bookmarks

⌘D opens `BookmarkPopover.vue` anchored under the address-bar star icon:
- Name (default = current title, editable).
- Folder dropdown (default "Bookmarks Bar").
- Save / Remove.

`browserBookmarks` Pinia store, `construct:browser:bookmarks:v1`:

```ts
interface Bookmark {
  id: string;
  url: string;
  title: string;
  favicon: string | null;
  folderId: string;
  createdAt: number;
}
interface BookmarkFolder {
  id: string;
  name: string;
  parentId: string | null;
}
```

Default folders: `bookmarks-bar` (root), `other` (root).

`BrowserBookmarksBar.vue` between chrome and content. Setting `showBookmarksBar` (default `true`). Renders horizontal scrollable row of favicon+title chips. Click → navigate active tab; right-click → Edit / Open in New Tab / Remove.

`about:bookmarks` (`BrowserBookmarksPage.vue`) — full manager: list, search, create folder, drag-reorder, edit, delete.

### 8.3 History view

`about:history` (`BrowserHistoryPage.vue`):
- Lists entries grouped by day (Today / Yesterday / <date>).
- Search box (filters across title + url).
- "Clear browsing data" button → modal with checkboxes: History / Cookies / Cache.
- Delete row (×) per entry.

Cookies/cache clearing via Rust command `browser_clear_data(scopes)` calling `webview.clear_all_browsing_data()` (Tauri 2). Scoped to all browser tab webviews (loops over labels in `BrowserState`).

### 8.4 Internal URL routing

Extend `frontend/browser/settings.ts`:

```ts
export const INTERNAL_BOOKMARKS_URL = 'about:bookmarks';
export const INTERNAL_HISTORY_URL = 'about:history';
export const INTERNAL_DOWNLOADS_URL = 'about:downloads';
```

`isInternalBrowserUrl` extended; `BrowserApp.vue::activeInternalPage` extended with three new branches; `<template>` renders the corresponding component.

---

## 9. File layout summary

### New files

```
frontend/browser/
  composables/
    useBrowserShortcuts.ts
    useBrowserHistory.ts
    useBookmarks.ts
    useDownloads.ts
    useTabSession.ts
  internal/
    BrowserBookmarksPage.vue
    BrowserHistoryPage.vue
    BrowserDownloadsPage.vue
  stores/
    browserHistory.ts
    browserBookmarks.ts
    browserDownloads.ts
  findController.ts
  shortcuts.test.ts
  history.test.ts
  bookmarks.test.ts
  downloads.test.ts
  findController.test.ts

frontend/components/browser/
  BrowserAddressBar.vue
  BrowserSuggestionsDropdown.vue
  BrowserFindBar.vue
  BrowserDownloadsBar.vue
  BrowserBookmarksBar.vue
  BookmarkPopover.vue
  tabContextMenu.ts
  pageContextMenu.ts

desktop/src/
  browser_find.js
```

### Edited files

- `frontend/browser/BrowserApp.vue` — remove bridge timer, wire shortcuts, find, zoom, devtools, context menus, downloads, bookmarks, internal pages, loading state, pinned tabs, closed-tabs stack, crash overlay.
- `frontend/browser/popupRouting.ts` — handle `foreground` flag; cmd/middle/shift cases.
- `frontend/browser/settings.ts` — add `saveHistory`, `showBookmarksBar`, `zoomByOrigin`; new internal URLs.
- `frontend/browser/BrowserSettingsPage.vue` — toggles for history, bookmarks bar, default zoom, clear data button.
- `frontend/browser/pageBridge.ts` — new event constants (`BROWSER_LOADING_EVENT`, `BROWSER_PAGE_CONTEXT_EVENT`, `BROWSER_FIND_RESULT_EVENT`, `BROWSER_DOWNLOAD_EVENT`); extended payload types.
- `frontend/components/browser/BrowserHeader.vue` — slim, delegate address bar to new component, add tab context-menu emit, pinned-tab rendering, loading spinner.
- `desktop/src/browser.rs` — remove ensure-bridge listener; new commands `browser_build_init_script`, `browser_set_zoom`, `browser_find`, `browser_devtools_toggle`, `browser_clear_data`, `browser_download_action`; emit download events.
- `desktop/src/browser_page_bridge.js` — extended click handler; loading events; page-context event.
- `desktop/src/lib.rs` — register new commands.

### Removed

- `BROWSER_ENSURE_PAGE_BRIDGE_EVENT` constant + listener.
- `startBridgeTimer` / `clearBridgeTimer` in `BrowserApp.vue`.
- `tab.bridgeTimer` field.

---

## 10. Data flow (after)

```
WebviewBuilder
  .initialization_script(construct_ipc.js + browser_page_bridge.js)
  .with_download_handler(...)
  → page bridge fires:
      BROWSER_PAGE_STATE_EVENT       (url, title, favicon)
      BROWSER_POPUP_EVENT            (cmd/middle/shift/_blank/window.open)
      BROWSER_LINK_CONTEXT_EVENT     (right-click on link)
      BROWSER_PAGE_CONTEXT_EVENT     (right-click anywhere)
      BROWSER_LOADING_EVENT          (start/end)
      BROWSER_FIND_RESULT_EVENT      (current, total)
  → host BrowserApp:
      routes to tab state
      mirrors history into Pinia (debounced)
      mirrors downloads into Pinia
      shows native menus
      renders find bar / downloads bar / bookmarks bar / internal pages
  → host emits to Rust:
      browser_set_zoom, browser_find, browser_devtools_toggle,
      browser_download_action, browser_clear_data,
      browser_build_init_script
```

---

## 11. Error handling

- `webview.eval` failures: log + ignore (page may have navigated).
- Stores: guard `JSON.parse`, fall back to defaults; cap entries to prevent unbounded growth.
- Downloads: missing target dir → fall back to `~/Downloads`; permission failures surface in `BrowserDownloadsBar` with retry.
- `clear_all_browsing_data` errors: surface in modal with stderr.
- Find: empty query clears highlights; no matches → `0 of 0` display.
- DevTools: command no-op in release builds.

---

## 12. Testing

### Vitest (auto)

- `popupRouting.test.ts` — extend with cmd/middle/shift/foreground cases, settings combinations.
- `shortcuts.test.ts` — keymap dispatch via mock window events; verifies focus-ignore rules.
- `history.test.ts` — query ranking, dedup, eviction at cap, debounced add, privacy-off no-op.
- `bookmarks.test.ts` — CRUD, folder ops, persistence round-trip.
- `downloads.test.ts` — state machine, cap eviction, completed vs in-progress separation.
- `findController.test.ts` — script template builds with safe escaping; matches against fixture HTML.
- `settings.test.ts` — extend for new fields' sanitization and defaults.

### Manual checklist

- target=_blank on github.com, google.com, twitter.com → opens new tab without race
- cmd+click, middle-click, shift+click → expected new-tab/foreground behavior
- All keyboard shortcuts on macOS + Linux
- Find in page on docs.python.org / mdn / sites with iframes (iframes deferred — note in shipped notes)
- Zoom persists per origin across reload + restart
- DevTools toggles in dev build
- Downloads from a direct .zip link, completion + reveal in Finder
- Bookmark add → appears in bar → click navigates
- History view groups by day, search filters, clear works
- Pinned tab survives close-attempt, persists across restart

---

## 13. Out of scope (deferred)

- Mute/unmute tab (needs wry audio API)
- Reader mode
- Picture-in-picture
- Password manager / autofill
- Sync (history, bookmarks across devices)
- Extension / userscript support
- Per-tab incognito (separate scope: profiles already segregate storage)
- Iframe-aware find-in-page
- Address-bar autocomplete inline-fill (only dropdown for v1)

---

## 14. Migration / compatibility

- `BrowserSettings` schema gains `saveHistory`, `showBookmarksBar`, `zoomByOrigin`. `sanitizeBrowserSettings` defaults missing fields → existing users unaffected on first read.
- Old `BROWSER_ENSURE_PAGE_BRIDGE_EVENT` removed; no external listeners.
- Tab state shape adds `loading`, `pinned`, `crashed`, `zoom`. Defaults `false / false / false / 1.0`.
- No migration needed for storage keys (all new).

---

## 15. Risks

- **wry init-script API**: Tauri 2 `WebviewBuilder::initialization_script` exists; the per-tab `Webview` constructor in JS may not accept the option directly. Mitigation: if frontend-side option is missing, expose a Rust command `browser_create_tab_webview(...)` that wraps `WebviewBuilder` in Rust and returns the label; replace `new Webview(...)` calls with this.
- **CSS Custom Highlight API on WKWebView**: shipped Safari 17.2+. macOS WKWebView uses host Safari engine — verify before relying. Fallback: `window.find()`.
- **Download handler closures + shared state**: must be `Send + Sync` and clone-safe; use `AppHandle` clones into closures.
- **Address-bar dropdown z-index over native webview**: native webview overlays can't be covered by HTML. Mitigation: while suggestions dropdown is open, hide active webview (`webview.hide()`) and show a snapshot or blank — same pattern as existing `activeInternalPage`. Verify perceived flicker is acceptable; if not, shrink webview height to make room for dropdown instead.
- **Find bar overlay**: same z-index issue. Mitigation: shrink active webview height by find-bar height while open (re-trigger `syncActiveWebview`).
- **Init-script size**: `construct_ipc.js` + `browser_page_bridge.js` concatenated is ~12KB; fine to inject every navigation.

---

## 16. Acceptance criteria

- target=_blank links open in a new tab on at least 5 representative sites (github, google, twitter, mdn, news.ycombinator).
- All keyboard shortcuts in §4 work on macOS; cmd → ctrl mapping works on Linux.
- Find-in-page highlights matches and reports `current of total`.
- Zoom adjusts per-tab and persists across restart per origin.
- DevTools opens/closes in debug builds.
- Right-click on page shows context-aware menu; right-click on tab shows tab menu.
- Address bar suggests from history while typing; Enter commits.
- Bookmarks bar shows bookmarks; ⌘D adds.
- Downloads tracked, surface in bar, openable from `about:downloads`.
- History viewable, searchable, clearable from `about:history`.
- All new Vitest suites pass.
- No regressions in existing `popupRouting.test.ts` / `settings.test.ts`.
