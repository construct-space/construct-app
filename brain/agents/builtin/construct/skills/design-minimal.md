---
id: design-minimal
name: Minimal
description: Quiet, generous whitespace, single accent, near-monochrome — content is the design. Reference: Apple marketing pages, Linear, Things 3.
triggers: ["minimal", "minimalist", "clean", "quiet design", "whitespace", "less is more"]
mode: design-system
surface: web
scope: builder
requires_design_system: false
example_prompt: "Build the landing page in minimal style."
---

# Minimal

## 1. Atmosphere
Quiet, confident, breathable. Content is foregrounded; the system disappears. Every element earns its place. Pace is unhurried; one idea per section.

## 2. Color
- `surface: #FFFFFF`
- `text: #0A0A0A`
- `ink-500: #6B7280` — meta
- `ink-100: #F3F4F6` — section breaks
- `accent: #2563EB` (or one chosen brand color) — used sparingly
- `border: #E5E7EB` — hairlines only

Two colors carry the system: text and accent. Everything else is tonal.

## 3. Typography
- Single sans family: Inter, Söhne, or system-ui
- Scale: `14 / 16 / 18 / 24 / 40 / 64`
- Weights: 400 / 500 / 600 / 700
- Generous line-height: 1.6 on body, 1.15 on h1
- Tracking neutral

## 4. Spacing & Grid
- 8pt baseline
- Container `max-w-5xl` — narrower than typical
- Vertical rhythm 96–160px between sections
- Card padding `p-8` minimum; tight padding kills the system

## 5. Layout
- Single-column hero, left or centered
- One headline + one paragraph + one CTA per section
- Avoid 3-column grids for content — 2 reads better
- Imagery sized restrained; full-bleed is rare, intentional

## 6. Components
- Buttons: simple rectangle or pill, `bg-text` for primary / `bg-transparent border` for secondary
- Cards: `border: 1px solid border`, optional subtle shadow `shadow-sm` on hover only
- Inputs: simple border + clear focus ring in accent
- Nav: thin, top-aligned, minimal labels, sticky-blur on scroll

## 7. Motion
- 200ms ease-out
- Hovers brighten or underline, never scale > 1.02
- Page transitions: fade or none
- Scroll-triggered fade-ins acceptable, subtle (translateY 8px max)

## 8. Voice
- Sentence case
- Microcopy is concrete and warm: "Get started", "Read the docs"
- One idea per sentence
- No marketing adjectives ("seamless", "powerful", "robust")

## 9. Anti-patterns
- Multiple competing accent colors
- Heavy drop shadows
- Decorative SVGs without purpose
- Trust-badge logo rows in the hero
- Excessive icons next to every list item
- "Hero CTA + secondary CTA + tertiary text link" — pick one
- Stock photography of teams smiling at laptops
- Animation on every element on scroll
