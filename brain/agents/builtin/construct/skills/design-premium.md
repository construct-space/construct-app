---
id: design-premium
name: Premium / Luxury
description: Dark canvas, refined accent, generous whitespace, weighted serif display, restrained motion. Reference: Tesla, Bugatti, high-end real estate, watch brands.
triggers: ["premium", "luxury", "high-end", "dark refined", "automotive premium", "watch brand"]
mode: design-system
surface: web
scope: builder
requires_design_system: false
example_prompt: "Build the homepage for an automotive brand in the premium system."
---

# Premium / Luxury

## 1. Atmosphere
Dark, considered, expensive. Slow rhythm, generous air, restrained palette. Conveys craft and selectivity. The page tells you it costs money — but never says so.

## 2. Color
- `surface: #0A0A0A` — near-black canvas
- `surface-2: #141414` — section breaks
- `surface-3: #1F1F1F` — cards
- `text: #F5F5F4`
- `ink-300: #A3A29F` — meta
- `accent: #C9A961` or `#B0935A` (champagne) — sparingly
- `border: rgba(255,255,255,0.08)` — hairlines only

No pure white anywhere. No saturated colors.

## 3. Typography
- Display: high-contrast serif — GT Sectra, Canela, or Playfair Display, weight 600/700
- Body: humanist sans — Inter, Söhne, or Untitled Sans, weight 400
- Scale: `14 / 16 / 18 / 22 / 36 / 64`
- Heading tracking tight `-0.02em`, body neutral
- Numerals tabular for prices and specs

## 4. Spacing & Grid
- 12-column grid, large margins (`max-w-7xl mx-auto px-8`)
- Section rhythm: 160–240px vertical
- Card padding generous: `p-10` minimum

## 5. Layout
- Hero is 90vh+ with a single elegant statement and one CTA
- Imagery wins: full-bleed product photography, minimal overlay text
- Specs presented as quiet tables, not flashy stat blocks
- Asymmetric, never crowded — empty space is the message

## 6. Components
- Buttons: pill or razor-sharp rectangle, `border: 1px solid accent`, ghost first / fill second
- Cards: `border: 1px solid border`, no radius beyond 4px, no shadow
- Inputs: bottom border only, label above, accent on focus
- Nav: thin, top-aligned, sticky on scroll with backdrop-blur

## 7. Motion
- Slow: 400–600ms ease-out for hero entrances
- Page transitions fade through near-black, optional
- Hover: subtle brightness lift, never scale
- Cursor follows are acceptable if disciplined

## 8. Voice
- Sentence case or, for h1, all-caps with wide tracking
- Microcopy is short and certain: "Reserve", "Configure", "See the craft"
- No exclamation marks. No casual contractions. "Cannot" not "can't"
- Numbers in display weight when they matter

## 9. Anti-patterns
- Bright primary CTAs (red, blue, green)
- Drop shadows beyond hairline
- Stock photography
- "Limited time" countdowns
- More than 3 sections above the fold
- Lottie animations of dancing dots
- Trust-badge logos in a row
- Pastel accent colors
