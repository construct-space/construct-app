---
id: design-editorial
name: Editorial
description: Magazine-inspired editorial system — serif display type, structured grids, generous whitespace, elegant reading rhythm. Reference brands: The Verge, Medium, NYT.
triggers: ["editorial", "magazine", "publication", "longform", "blog design", "serif design"]
mode: design-system
surface: web
scope: builder
requires_design_system: false
example_prompt: "Build the home page using the Editorial design system."
---

# Editorial

## 1. Atmosphere
Refined, considered, calm. Reads like a print magazine that learned the web. Strong serif voice, lots of air, restrained color. Pace is *slow* — every element earns its place.

## 2. Color
- `primary: #111111` — interaction, headlines
- `surface: #FFFFFF` — page
- `surface-warm: #FAF7F2` — featured sections
- `text: #1A1A1A`
- `ink-500: #6B6B6B` — meta, captions
- `accent: #B45309` — sparing, for links and rare emphasis (amber)
- `border: #E7E2D9` — hairline rules

Anti-pairing: never put accent on warning yellow.

## 3. Typography
- Scale: `14 / 16 / 18 / 22 / 32 / 56`
- Display: serif — Playfair Display, Fraunces, or GT Sectra
- Body: sans — Inter, Outfit, or Source Sans
- Mono: only for code blocks
- Weights: display 700/800, body 400/500/600
- h1 line-height 1.05, body 1.65

## 4. Spacing & Grid
- 8pt baseline
- Container: `max-w-3xl` for articles, `max-w-6xl` for landing
- Section rhythm: 80–120px vertical between sections
- Drop caps allowed on first paragraph of a longform piece

## 5. Layout
- Centered single-column for reading; 12-col grid for landing
- Pull-quotes break the column with serif italic at 32–40px
- Images full-bleed or with captions in `ink-500` italic
- Bylines + read time in small caps under the H1

## 6. Components
- Buttons: pill or sharp rectangle, single weight, **never** drop-shadow
- Cards: hairline border `1px solid border`, no shadow
- Links: underlined on hover, accent color on visited optional
- Nav: thin, top-aligned, single row, serif wordmark

## 7. Motion
- 200ms ease-out on hovers
- Page transitions: no — let the content do the work
- No parallax. No autoplay video in hero.

## 8. Voice
- Sentence case everywhere
- Microcopy is sparse and confident: "Read", "Listen", "Subscribe"
- No emoji, no exclamation marks
- Bylines like "by First Last", dates like "March 15, 2026"

## 9. Anti-patterns
- Gradient backgrounds
- Multiple display fonts
- Cards with shadow + border + ring
- Stock photography of people at laptops
- "Hero CTA + secondary CTA + tertiary CTA" — pick one
- Sans-serif for the H1
- Rounded buttons combined with sharp images
