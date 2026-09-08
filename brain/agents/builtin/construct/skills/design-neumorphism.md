---
id: design-neumorphism
name: Neumorphism
description: Soft 3D surfaces emerging from the background using paired inner + outer shadows. Monochrome, tactile, calm. Reference: dribbble 2019–2020 era, soft UI.
triggers: ["neumorphism", "soft ui", "soft 3d", "extruded surface", "monochrome ui"]
mode: design-system
surface: web
scope: builder
requires_design_system: false
example_prompt: "Build the dashboard in soft UI neumorphism."
---

# Neumorphism

## 1. Atmosphere
Calm, tactile, monochromatic. Elements feel pressed *into* or *out of* the canvas like soft clay. Best on dashboards, calculators, music players — small surfaces with a few controls. Bad on content-heavy pages (kills hierarchy).

## 2. Color
- `surface: #E0E5EC` — the canvas (this is the system)
- `text: #2D3748`
- `ink-500: #4A5568`
- `accent: #4F46E5` — used very sparingly on active states
- `shadow-dark: rgba(163, 177, 198, 0.6)`
- `shadow-light: rgba(255, 255, 255, 0.8)`

The accent is the *only* place real color appears. Everything else is monochrome.

## 3. Typography
- Sans, rounded if available — Nunito, Quicksand, or Inter
- Scale: `12 / 14 / 16 / 20 / 28 / 40`
- Weights: 400 / 600 / 700
- Body color slightly muted — `ink-500` not pure black

## 4. Spacing & Grid
- 8pt baseline
- Components need air — `p-6 minimum` so shadows can render
- Vertical rhythm 32–48px between sections

## 5. Layout
- Centered cards on a soft tinted bg
- Avoid overlapping elements — shadows must not collide
- Backgrounds stay flat — no gradients beneath neumorphic elements

## 6. Components
- Raised: `box-shadow: -8px -8px 16px rgba(255,255,255,0.8), 8px 8px 16px rgba(163,177,198,0.6)`
- Pressed: same but inset
- Button toggle states map directly to raised → pressed transition
- Inputs: pressed inset on default, slight outer on focus
- Cards: gentle raised
- Radius: `1rem`–`1.5rem` (must be rounded; sharp neumorphism doesn't work)

## 7. Motion
- 200–250ms cubic-bezier(0.4, 0, 0.2, 1)
- State transitions interpolate the shadows
- Press transitions on click are mandatory — that's the metaphor

## 8. Voice
- Sentence case
- Calm, minimal microcopy: "Save", "Cancel", "+ New"
- Numbers and icons over labels where possible

## 9. Anti-patterns
- Text directly on the neumorphic surface without enough contrast (accessibility killer)
- Mixing neumorphism with flat or material surfaces in the same screen
- Drop shadows from another paradigm
- High-contrast color anywhere except the accent
- Borders — the shadow *is* the border
- Tiny components (< 44px) — shadow can't render cleanly
- Photos or imagery on neumorphic cards (clashes)
