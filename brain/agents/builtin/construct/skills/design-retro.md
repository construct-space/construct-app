---
id: design-retro
name: Retro
description: 70s–80s revival aesthetic — warm muted palette, geometric display type, sticker badges, halftone or grain textures, nostalgic without being kitsch. Reference: Sunset run, 80s synthwave, vintage travel posters.
triggers: ["retro", "vintage", "70s", "80s", "synthwave", "nostalgia", "vintage poster"]
mode: design-system
surface: web
scope: builder
requires_design_system: false
example_prompt: "Build the about page in retro 70s style."
---

# Retro

## 1. Atmosphere
Warm, nostalgic, hand-crafted feel. Borrows from 70s graphic design, vintage travel posters, and 80s synthwave covers. Confident in its references without being a pastiche.

## 2. Color
- `surface: #F5E6D3` (cream) or `#1A1B3A` (synthwave night)
- `primary: #E63946` (burnt red) or `#FF6B9D` (synth pink)
- `secondary: #F4A261` (mustard) or `#06FFA5` (mint)
- `accent: #2A9D8F` (teal) or `#FFE66D` (sun yellow)
- `text: #264653` on cream, `#FFF8E7` on night
- Limited palette: 4–5 colors max, used boldly

## 3. Typography
- Display: geometric or condensed retro sans — Recoleta, Monoton, Bungee, or DM Serif Display
- Body: warm sans — DM Sans, Sora, or Outfit
- Scale: `14 / 16 / 18 / 24 / 40 / 80`
- Weights: 400 / 700 / 900
- Letter-spacing on display: very wide (`tracking-widest`) for poster vibes

## 4. Spacing & Grid
- 8pt baseline
- Composition over grid — slight tilts and overlaps are encouraged
- Section rhythm 96–160px

## 5. Layout
- Sticker-style badges scattered: rounded rotated tags with "NEW", "BEST", year stamps
- Halftone, grain, or noise overlay across whole page for warmth
- Hero often centered with arched / circular text
- Decorative SVG (sunbursts, stars, waves) at section corners

## 6. Components
- Buttons: pill or rounded rectangle, solid fill, often with offset shadow `4px 4px 0 black`
- Cards: chunky borders or grain overlay, slight rotation
- Badges: rotated stickers with thick outline
- Dividers: zigzag, dotted, or wave SVG, not flat lines

## 7. Motion
- 250ms ease-out
- Sticker tilt on hover (rotate ±2°)
- Marquee for trust signals or featured items
- VHS-style scanline or flicker on a single hero element max

## 8. Voice
- Friendly, slightly nostalgic: "Welcome back.", "Made the old way.", "Est. 2026"
- Title Case or ALL CAPS on display
- Tagline language: short, declarative, slightly poetic
- Year stamps and locations as personality ("Made in Prishtina")

## 9. Anti-patterns
- More than 5 saturated colors
- Photorealistic stock photos
- Drop shadows that fade smoothly (use hard offset instead)
- Modern sans display fonts (Inter, Söhne) — wrong era
- Glass or neumorphism mixed in
- Too many overlaid grain textures (one is enough)
- Clean gradients — retro gradients want banding, not smoothness
