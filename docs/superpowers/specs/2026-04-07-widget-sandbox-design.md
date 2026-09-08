# Widget Sandbox Design

Date: 2026-04-07

## Problem

Widgets render as inline Vue components in the same DOM document as the main app. They have full access to `document`, `window.__CONSTRUCT__`, Tauri APIs, Pinia stores, router, and every other global. A widget was able to read and expose surrounding page DOM text including project names, navigation labels, and local paths (#29). Widgets can also play audio (#31) and attempt navigation they shouldn't have access to (#28).

## Design Principles

1. **Widgets are cards** — lightweight shortcuts on the home dashboard. Display + simple actions.
2. **Two tiers** — built-in widgets get a small action API (navigate, newSession). Marketplace widgets are static readonly cards — display only, one-way.
3. **Closed Shadow DOM** — every widget renders in a custom element with a closed shadow root. No iframe overhead. No DOM escape.
4. **Frozen API** — widgets receive a frozen, read-only API object. No globals, no Tauri, no stores.
5. **Space composables are fine** — widgets can import their own space's composables for data. They can't reach outside.

## Architecture

### Widget Rendering

Every widget renders inside a custom element with closed Shadow DOM:

```
<widget-card space-id="brainstorm" widget-id="quick-start">
  #shadow-root (closed)
    <div class="widget-root">
      <!-- widget content mounts here -->
    </div>
</widget-card>
```

What closed Shadow DOM provides:
- Widget can't `querySelector` outside its shadow root
- Widget styles are scoped — no leak, no inheritance
- Host can't accidentally restyle widget internals
- CSS custom properties (theme vars) still pierce the boundary for theming

### Widget Mounting Flow

`WidgetChrome.vue` changes from `<component :is="widgetComponent" />` to:

1. Create a custom element `<widget-card-{spaceId}>`
2. Attach closed shadow root: `attachShadow({ mode: 'closed' })`
3. Inject theme CSS variables into a `<style>` element in the shadow root
4. Create an isolated Vue app (`createApp`) — NOT the main app
5. `app.provide('widgetApi', Object.freeze(api))` — the only bridge
6. `app.mount(shadowRoot)`

The widget gets its own `createApp`. It cannot access the main app's Pinia stores, router, or provide/inject tree. Space composables that fetch their own data (localStorage, own API) still work. Composables that depend on the main app's provide chain won't — which is the point.

### Widget API

Each widget receives a frozen API object via provide/inject.

Built-in widget API:
```typescript
interface BuiltinWidgetApi {
  theme: { mode: 'dark' | 'light'; vars: Record<string, string> }
  space: { id: string; name: string; icon: string }
  actions: {
    navigate: (path: string) => void
    newSession: (params?: any) => void
  }
}
```

Marketplace widget API:
```typescript
interface MarketplaceWidgetApi {
  theme: { mode: 'dark' | 'light'; vars: Record<string, string> }
  space: { id: string; name: string; icon: string }
  // no actions — display only
}
```

### What Gets Locked Down

Stripped from the widget scope before mounting:
- `window.__CONSTRUCT__` — the global host API
- `window.construct` — auth tokens, project context, storage
- Tauri APIs (`__TAURI__`, `invoke`, file system, shell, dialogs)
- `Audio`, `HTMLMediaElement` — widgets are cards, not media players
- `parent`, `top`, `frames` — no frame-busting

The frozen API is the only channel. Built-in widgets communicate actions via custom events on the custom element (`widget:navigate`, `widget:newSession`). The host listens and handles. Marketplace widgets have no event listeners attached — even if they emit, nobody listens.

### Data Flow

Widgets manage their own data through their space's composables. The host does not provide or broker space data.

Example: brainstorm widget imports `useBrainstormSessions()` from its own space bundle, fetches recent sessions, renders them. The host doesn't know or care what data the widget shows.

## Related Issues Fixed

### #29 — Widget can access surrounding page DOM text
Fixed by closed Shadow DOM. `document.querySelector` from inside the shadow root cannot reach the parent document.

### #31 — Widgets playing overlapping audio
Fixed by stripping `Audio` and `HTMLMediaElement` from the widget scope. Widgets are cards, not media players.

### #28 — Widget "Open Space" button does nothing
Fixed by the action API. Built-in widgets call `actions.navigate('/brainstorm')`, which emits a `widget:navigate` custom event. The host handles routing.

### #30 — Widget disappears after restart
Separate persistence bug in `useWidgetRegistry.ts`. The user's dashboard layout (which widgets, positions, sizes) needs to persist to the app data dir and restore on mount. Not a sandboxing issue, but fixed as part of this work.

### #24, #25 — Widget sidebar close interactions
Pure UI bugs in `HomePage.vue`. Fixed as standalone changes, not part of the sandbox design.

## Files Affected

### Modified
- `frontend/components/home/WidgetChrome.vue` — replace inline component with custom element + shadow root mounting
- `frontend/composables/useWidgetRegistry.ts` — add layout persistence, widget tier detection (builtin vs marketplace)
- `frontend/pages/HomePage.vue` — fix sidebar close interactions (#24, #25)
- `frontend/lib/spaceHost.ts` — stop exposing globals unconditionally

### New
- `frontend/lib/widgetSandbox.ts` — custom element registration, shadow root creation, global stripping, API freezing
- `frontend/lib/widgetApi.ts` — BuiltinWidgetApi and MarketplaceWidgetApi type definitions and factory

## Marketplace Review Gate

Since marketplace spaces are reviewed before publishing, add static analysis checks to the CLI build/publish step:

- No direct `document` or `window` access outside composables
- No `parent`, `top`, `frames` references
- No dynamic script injection (`eval`, `new Function`, `innerHTML` with scripts)
- No `MutationObserver` or `ResizeObserver` on elements outside shadow root
- No prototype pollution (`__proto__`, `Object.defineProperty` on globals)

The shadow DOM is the runtime boundary. The review is the trust boundary.

## Testing

- Test that widget cannot access `document.body.textContent` from inside shadow root
- Test that `window.__CONSTRUCT__` is undefined inside widget scope
- Test that `window.__TAURI__` is undefined inside widget scope
- Test that `Audio` constructor throws inside widget scope
- Test that built-in widget actions emit correct custom events
- Test that marketplace widget has no action API
- Test that theme CSS variables are available inside shadow root
- Test that widget layout persists across restart
