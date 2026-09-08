---
id: design-swiss
name: Swiss International
description: International Typographic Style — grid, neutral sans, primary colors used as accent, ruthless hierarchy. Reference brands: Helvetica era, Bauhaus, Vignelli.
triggers: ["swiss", "international style", "helvetica", "grid design", "bauhaus", "vignelli"]
mode: design-system
surface: web
scope: builder
requires_design_system: false
example_prompt: "Build a portfolio landing in the Swiss design system."
---

# Swiss International

## 1. Atmosphere
Rational, objective, grid-locked. Information first, decoration zero. Reads like a 1960s railway timetable that got web-native. Confident in its silence.

## 2. Color
- `primary: #E10600` — single hot accent (Swiss red)
- `surface: #FFFFFF`
- `text: #0A0A0A`
- `ink-300: #999999`
- `ink-100: #E5E5E5` — rules and dividers
- `accent-blue: #0050B5` — used only when red is taken

Never gradients. Never three accents on one page.

## 3. Typography
- Scale: `12 / 14 / 16 / 24 / 48 / 96`
- Single family: neutral sans — Helvetica, Inter, or Söhne
- Weights: 400 / 500 / 700 — that's it
- Display weights are large + tight, never bold + medium-size
- Line-height 1.2 on h1, 1.5 on body

## 4. Spacing & Grid
- 12-column grid, visible (faint) in dev
- 8pt baseline
- Page margins equal to gutter; rhythm is exposed, not hidden
- Sections separated by 96–160px

## 5. Layout
- Asymmetric balance — primary content takes 8 cols, sidebar 4
- Generous left-alignment; centered is rare and intentional
- Numbers and dates as design elements (oversized, brand-red)
- Images are full-bleed photographs or sharp diagrams, never illustrations

## 6. Components
- Buttons: sharp rectangle, single weight, primary-red fill or black outline
- Cards: no shadow, no radius — just `1px solid ink-100`
- Inputs: bottom border only, label above, no placeholder cosmetics
- Nav: top-left wordmark, top-right links, single row, ruled separator under

## 7. Motion
- 100–150ms ease-linear
- No spring, no bounce, no parallax
- Hover states are color swaps or underline appearance, never scale

## 8. Voice
- Sentence case
- Microcopy is literal: "Send", "Open", "Close"
- No exclamation marks, no emoji, no metaphors
- Numbered lists preferred over bulleted

## 9. Anti-patterns
- Drop shadows
- Rounded corners > 4px
- Gradients
- Multiple typefaces
- Decorative SVG illustrations
- "Hero with floating UI elements"
- Glassmorphism, neumorphism — any -ism that adds depth
