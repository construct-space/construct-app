# Space Widgets for Home

## Status: V1 Implemented

### V1 Implementation Notes

V1 was intentionally scoped narrower than the original plan below:

- **Grid**: Two-zone layout:
  - **Built-in strip (12×2)**: Fixed Construct widgets, not user-configurable
  - **Space grid (12×8)**: User-customizable space widgets via picker
  - **Total**: 12×10
- **Widget bundling**: Widgets are bundled inline with the main space IIFE (not separate per-size bundles under `dist/widgets/`). `dist/widgets/manifest.json` is metadata-only.
- **Widget authoring**: Widgets declared directly in `space.manifest.json` `widgets` array. No per-widget `widget.json` files.
- **Scaffold**: Creates `widgets/summary/` with 2x1.vue and 4x1.vue. No README or widget.json per widget.
- **Built-in widgets** (12×2, fixed): Current User (4x2), Vibe + Architect (4x1 stacked), Quick Chat (4x2)
- **Space widgets** (12×8, customizable): Any installed space can contribute widgets
- **No drag-to-move or resize** in V1. Add/remove only, auto-positioned.
- **Persistence**: localStorage (`construct:home_layout`)

The original plan below remains as the V2+ roadmap.

## Problem

Home is currently a simple landing page with recent projects and quick links. We want it to become a widget surface where installed spaces can contribute small, glanceable views, similar to the macOS widget browser.

The key product requirements are:

- Home uses a fixed 12×2 grid (V1), expandable to 12×8 in V2
- Widgets occupy grid cells with sizes from `1x1` up to `4x2` (V1)
- Spaces can ship widgets as part of the space package
- When a space is installed, Construct can discover its widgets and offer them in a widget picker
- `construct space scaffold` should create a `widgets/` directory with example `2x1` and `4x2` widgets plus a README that documents the allowed widget model

## Goals

- Let any installed space expose optional Home widgets
- Keep the widget contract simple enough that a space author can understand it from the scaffolded files
- Reuse the existing space install flow so widgets ship with the installed space
- Keep Home performant by loading widget metadata first and widget code lazily
- Make the picker feel like the macOS widget browser: browse by space, preview size variants, then add to Home

## Non-goals for V1

- Full widget configuration UIs
- Complex project-bound widgets that require selecting a project before render
- Arbitrary freeform sizing beyond the 12x8 cell grid
- Nested widget composition or widget-to-widget communication
- Mobile-first behavior beyond a reasonable desktop fallback

## Recommended Product Shape

### Home surface

- Replace the current loose Home layout with a dashboard-style 12-column by 8-row grid
- Each widget instance stores `x`, `y`, `w`, `h`, `spaceId`, `widgetId`, and `sizeKey`
- Sizes are any width/height from `1` to `4`, encoded as `1x1`, `2x1`, `2x2`, ..., `4x4`
- Prevent overlap and placement outside the 12x8 bounds
- Allow add, remove, move, and resize within the allowed size variants the widget actually ships

### Widget picker

- Add an `Add Widget` action on Home
- Open a modal with:
- sidebar of installed spaces that expose widgets
- main area showing widgets from the selected space
- preview cards for each supported size, similar to macOS
- primary action: `Add to Home`
- After space install completes, if the installed space exposes widgets, show a lightweight follow-up CTA: `Add widgets`

### Widget behavior limits

V1 should stay intentionally narrow:

- Widgets are compact summary surfaces, not full mini-apps
- Widgets can contain lightweight buttons/links, but should not open modal flows on mount
- Widgets should render without blocking on long network fetches
- Widgets should tolerate missing data and show empty/loading states cleanly
- Widgets should not assume they have a project context unless that becomes an explicit V2 feature

## Space Contract

### Source layout

Scaffold every new space with:

```text
widgets/
  README.md
  example/
    widget.json
    2x1.vue
    4x2.vue
```

This gives authors one example widget with two size variants.

### Widget authoring model

Each widget lives in its own folder under `widgets/`.

Example:

```json
{
  "id": "example",
  "name": "Example Widget",
  "description": "Starter widget for Construct Home",
  "icon": "i-lucide-box",
  "defaultSize": "4x2",
  "sizes": {
    "2x1": "./2x1.vue",
    "4x2": "./4x2.vue"
  }
}
```

Recommended V1 fields:

- `id`
- `name`
- `description`
- `icon`
- `defaultSize`
- `sizes`
- optional `emptyState` metadata later if needed

### Space manifest extension

Add an optional `widgets` field to `space.manifest.json`, CLI manifest types, and SDK manifest types:

```json
{
  "widgets": {
    "manifest": "widgets/manifest.json",
    "version": 1
  }
}
```

Why keep this explicit:

- Home can discover widget-capable spaces without probing arbitrary directories
- We get a versioned contract for future changes
- The installed `manifest.json` remains the single entry point for space capabilities

## Build and Distribution

### Key constraint

The app only sees installed files under `dist/`. That means authoring widgets in a source `widgets/` folder is not enough by itself. The CLI build must emit widget artifacts into `dist/widgets/`, otherwise `construct space run` and marketplace install will never deliver them to Home.

### Build output

For a space with widgets, the build should generate:

```text
dist/
  manifest.json
  space-{id}.iife.js
  space-{id}.css
  widgets/
    manifest.json
    example/
      2x1.iife.js
      2x1.css
      4x2.iife.js
      4x2.css
```

`dist/widgets/manifest.json` should be generated, not hand-authored. It becomes the runtime index used by Home.

Suggested shape:

```json
{
  "spaceId": "git",
  "version": 1,
  "widgets": [
    {
      "id": "example",
      "name": "Example Widget",
      "description": "Starter widget for Construct Home",
      "icon": "i-lucide-box",
      "defaultSize": "4x2",
      "sizes": {
        "2x1": {
          "js": "widgets/example/2x1.iife.js",
          "css": "widgets/example/2x1.css"
        },
        "4x2": {
          "js": "widgets/example/4x2.iife.js",
          "css": "widgets/example/4x2.css"
        }
      }
    }
  ]
}
```

### CLI changes

- Extend `construct-cli/cmd/scaffold.go` to create `widgets/`, `widgets/README.md`, `widgets/example/widget.json`, `widgets/example/2x1.vue`, and `widgets/example/4x2.vue`
- Add scaffold templates under `construct-cli/templates/space/widgets/...`
- Extend manifest structs and templates to include the optional `widgets` field
- Add a widget build step in `construct-cli/cmd/build.go` or the Vite preset path
- That step should:
- scan `widgets/*/widget.json`
- validate size keys
- compile each size variant to an IIFE bundle plus CSS
- write `dist/widgets/manifest.json`
- Ensure `construct space run` copies `dist/widgets/` automatically via the existing full `dist/` copy

## Runtime Architecture

### Widget registry

Add a small registry layer in the app that:

- scans installed spaces
- reads each installed `manifest.json`
- checks for `manifest.widgets.manifest`
- reads the referenced widget manifest
- returns a flat catalog grouped by `spaceId`

This should be separate from the existing page-oriented `SpaceLoader`. Widgets are a different runtime surface.

### Widget loader

Add a dedicated widget loader that mirrors the existing space loader:

- reads widget JS/CSS paths from `dist/widgets/manifest.json`
- lazy-loads the requested size bundle only when needed
- evaluates the IIFE bundle against `window.__CONSTRUCT__`
- injects CSS once per widget size
- returns a Vue component for Home to mount

Recommended export model:

- widget bundle exports a single default Vue component
- host passes props such as `spaceId`, `widgetId`, `sizeKey`, and `instanceId`

### Persistence

Store Home widget layout separately from widget definitions.

Recommended storage for V1:

- use `useStorage()` with a dedicated key such as `home_layout`
- category: `home`
- localStorage fallback remains automatic for non-Tauri contexts

Suggested stored shape:

```json
{
  "version": 1,
  "items": [
    {
      "id": "home-widget-1",
      "spaceId": "git",
      "widgetId": "example",
      "sizeKey": "4x2",
      "x": 0,
      "y": 0,
      "w": 4,
      "h": 2
    }
  ]
}
```

## Home Implementation Plan

### Phase 1: Contract and schema

- Add widget types to the core manifest layers:
- `construct-cli/internal/manifest/manifest.go`
- `construct-sdk/src/types/manifest.ts`
- `construct-sdk/src/schemas/index.ts`
- Update docs describing space anatomy and build output

### Phase 2: CLI scaffold and widget build

- Add widget scaffold templates
- Add build-time widget discovery and validation
- Emit `dist/widgets/manifest.json`
- Emit one bundle per widget size variant
- Fail fast on invalid size keys or missing component files

### Phase 3: App-side discovery and loading

- Add a widget catalog composable, likely alongside `useSpaces`
- Add a widget loader parallel to `SpaceLoader`
- Cache loaded widget components to avoid repeated eval/injection

### Phase 4: Home dashboard UI

- Refactor `construct-app/frontend/pages/HomePage.vue` into focused pieces:
- Home header
- Home grid
- Widget chrome component
- Add-widget modal
- Implement placement, snapping, collision checks, remove, and resize
- Keep recent projects as either a built-in host widget or a top section above the grid during transition

### Phase 5: Install flow integration

- After marketplace install, re-scan widget-capable spaces
- If the installed space has widgets, show `Add widgets` CTA
- Pre-filter the picker to the newly installed space

### Phase 6: Testing and docs

- Unit tests for size parsing, placement, and collision logic
- Loader tests for widget manifest parsing and lazy bundle loading
- CLI tests that scaffold emits the expected widget files
- Build tests that `dist/widgets/manifest.json` and size bundles are produced
- Update author docs so widget creation is discoverable outside the scaffolded README

## File Areas Expected to Change

App:

- `construct-app/frontend/pages/HomePage.vue`
- new widget loader/composable files under `construct-app/frontend`
- `construct-app/frontend/composables/useSpaceMarketplace.ts`
- `construct-app/frontend/composables/useSpaces.ts` or a new `useSpaceWidgets.ts`
- `construct-app/frontend/composables/useStorage.ts` usage for layout persistence

CLI:

- `construct-cli/cmd/scaffold.go`
- `construct-cli/cmd/build.go`
- `construct-cli/templates/space/*`
- new widget scaffold templates under `construct-cli/templates/space/widgets/`
- manifest types in `construct-cli/internal/manifest/manifest.go`

SDK/docs:

- `construct-sdk/src/types/manifest.ts`
- `construct-sdk/src/schemas/index.ts`
- `docs/guide/anatomy-of-a-space.md`
- `construct-app/docs/architecture/spaces.md`

## Recommended V1 Decisions

To keep scope controlled, I recommend:

- only support widgets that render without a required project binding
- allow only declared size variants, not freeform resize to any `1..4 x 1..4` size the author did not ship
- make widget discovery explicit through `manifest.widgets.manifest`
- keep widget layout persistence app-local through `useStorage`
- lazy-load previews and live widgets instead of loading every widget bundle at Home startup

## Open Questions

- Should recent projects become a built-in host widget so Home is fully widget-driven from day one?
- Do we want spaces to be able to ship a static preview image for the picker, or should V1 use live-rendered previews only?
- Should V1 permit click-through deep links into a space page from a widget, or keep widgets read-mostly until the surface stabilizes?

## Suggested Rollout

1. Land the manifest/schema/scaffold contract first.
2. Land widget build output into `dist/widgets/`.
3. Build the app-side widget registry/loader.
4. Refactor Home into a grid and ship add/remove/place flows.
5. Add install-time widget CTA and author docs polish.
