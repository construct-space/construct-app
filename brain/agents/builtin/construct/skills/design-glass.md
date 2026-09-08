---
id: design-glass
name: Glassmorphism
description: Frosted-glass surfaces over rich backgrounds — backdrop blur, translucent panels, subtle borders, bright accent gradients. Reference: macOS Big Sur, Apple visionOS.
triggers: ["glassmorphism", "glass", "frosted", "blur surface", "translucent", "visionos"]
mode: design-system
surface: web
scope: builder
requires_design_system: false
example_prompt: "Build the pricing page in glassmorphism."
---

# Glassmorphism

## 1. Atmosphere
Light, atmospheric, slightly futuristic. Surfaces feel like frosted panels floating over a colored backdrop. Depth is felt, not stated. Best on hero sections and product pages with strong photography or gradients beneath.

## 2. Color
- `surface-glass: rgba(255,255,255,0.08)` — base panel
- `surface-glass-hover: rgba(255,255,255,0.14)`
- `border-glass: rgba(255,255,255,0.18)`
- `bg-gradient`: `linear-gradient(135deg, #6366F1 0%, #EC4899 50%, #F59E0B 100%)` or similar
- `text-on-glass: #FFFFFF` (on dark bg) or `#0A0A0A` (on light bg)
- `accent: #FFFFFF` with opacity for emphasis

The background is half the system. Without rich underlying color or imagery, glass looks like cheap plastic.

## 3. Typography
- Sans, modern: Inter, SF Pro, or Söhne
- Scale: `14 / 16 / 18 / 24 / 32 / 56`
- Weights: 400 / 500 / 600 / 700
- Text on glass needs **drop-shadow-sm** for readability when bg is busy

## 4. Spacing & Grid
- 8pt baseline
- Panels are large — `min-h-[200px]`, generous padding `p-8`
- Stack panels with consistent 16–24px gaps so the depth reads

## 5. Layout
- Always place glass over a colorful, blurred, or photographic backdrop
- Floating elements (cards, navs, modals) — never flush to a flat color
- Avoid pure-white pages — glass needs warmth beneath

## 6. Components
- Panel: `bg-white/8 backdrop-blur-xl border border-white/15 rounded-2xl`
- Button: pill, `bg-white/12 hover:bg-white/20 backdrop-blur` or solid contrast button on glass
- Input: `bg-white/5 border border-white/10`, glow on focus
- Nav: floating pill, sticky-top with margin

## 7. Motion
- Soft 250–350ms ease-out
- Hover lifts (translateY -2px) + brightens
- Backdrop blur intensifies on hover (12px → 20px)

## 8. Voice
- Concise, modern: "Get started", "See the demo"
- Sentence case
- Forward-looking copy: "Designed for", "Built around"

## 9. Anti-patterns
- Glass on flat white pages — there's nothing to refract
- Glass on every element (everything floating = nothing floats)
- Heavy drop-shadows on glass panels (the blur *is* the depth)
- Mixing glass with neumorphism
- Too many gradient stops (3 max)
- Glass on tiny components (buttons under 40px tall — looks muddy)
