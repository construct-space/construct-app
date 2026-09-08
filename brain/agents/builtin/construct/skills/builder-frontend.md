---
id: builder-frontend
name: Frontend Development
description: Build or modify user-facing screens, websites, dashboards, forms, navigation, responsive layouts, design systems, or visual interactions
trigger: "frontend,ui,ux,website,landing page,dashboard,admin,form,component,layout,responsive,css,tailwind,react,vue,svelte,next,nuxt"
category: construct
---

# Frontend Development

Build the actual usable screen, not a marketing explanation of it. Match the existing framework, router, styling system, component library, and density.

## First Decisions

- Identify the app type: landing page, content site, SaaS/dashboard, admin tool, editor, ecommerce, data view.
- Read existing layout/components before creating new primitives.
- Use existing icons/components. If the project uses lucide, use lucide.
- For dashboards/admin tools, prefer dense, scan-friendly UI over hero/card-heavy layouts.
- For landing/product pages, make the product or offer visible in the first viewport.

## Implementation Rules

- Do not introduce a new UI library, router, state library, or styling system unless the user asked.
- Stable dimensions matter: boards, toolbars, cards, tables, and buttons should not resize from hover/loading/text changes.
- Text must fit on mobile and desktop. Avoid viewport-scaled font sizes.
- No decorative gradient orbs/blobs. Use real product/place/person/media assets when the page needs visual weight.
- Make expected controls real: empty/loading/error states, disabled states, validation, filters, tabs, menus, toggles, sliders.

## Verification

Use the project’s checks, then visually exercise the UI:

1. Typecheck/lint/build/test where available.
2. `start_preview`.
3. `list_windows`.
4. `screenshot_window` for the preview.
5. Confirm no blank screen, error overlay, overlap, clipped text, or broken responsive layout.

If the change is interactive, click/type through at least one normal path and one failure or empty path.
