---
id: design-playful
name: Playful
description: Bright, energetic, character-led — illustrated mascots, bold rounded type, vibrant primaries, micro-interactions everywhere. Reference: Slack 2020, Headspace, Notion early.
triggers: ["playful", "bright", "energetic", "mascot", "fun design", "illustrated"]
mode: design-system
surface: web
scope: builder
requires_design_system: false
example_prompt: "Build the home page in the playful system."
---

# Playful

## 1. Atmosphere
Bright, character-rich, optimistic. Illustrations carry tone; micro-interactions reward exploration. Best for consumer products, education, productivity tools that want personality. Stops short of childish — there's still craft underneath.

## 2. Color
- `surface: #FFFAF0` or `#FFFFFF`
- `primary: #7C3AED` (purple), `#EC4899` (pink), or `#F59E0B` (amber)
- `secondary: #06B6D4` (cyan)
- `tertiary: #10B981` (green)
- `text: #1F2937`
- Saturated, slightly less than full — feels modern not garish

Three colors active per page, no more. Each owns a kind of action.

## 3. Typography
- Display: rounded/friendly — DM Sans, Nunito, Sora, Cabinet Grotesk
- Body: same family or sister sans
- Scale: `14 / 16 / 18 / 22 / 32 / 48`
- Weights: 500 / 700 / 900 — text wants weight
- Numerals tabular when shown as data

## 4. Spacing & Grid
- 8pt baseline
- Components have *air* — `p-6+` on cards
- Sections 80–120px vertical
- Slight intentional overlap of elements (illustration over a card) reads as playful

## 5. Layout
- Hero: headline + illustration takes 50/50 split
- Mascot or character drives section transitions
- Asymmetric, slight rotations on decorative elements (`-rotate-1`, `rotate-2`)
- Confetti or floating shapes in background of hero

## 6. Components
- Buttons: chunky pill, solid fill, subtle press animation
- Cards: rounded-2xl, light pastel-tinted backgrounds (one tint per card type)
- Inputs: rounded-xl, friendly placeholder copy
- Tags/badges: rounded, colored, slight bounce on appear

## 7. Motion
- Bouncy spring `cubic-bezier(0.34, 1.56, 0.64, 1)`
- Mascot reacts to scroll position or hover
- Hover states delight — wiggle, bounce, color flip
- Success state confetti or check-mark animation

## 8. Voice
- Warm, encouraging: "Let's go!", "You got this.", "Nice one."
- Title case on CTAs
- Emoji welcome in moderation
- Microcopy can be slightly self-aware: "Yep, we mean it."

## 9. Anti-patterns
- Premium/luxury serif display
- Dark canvas as default
- Drop shadows + neumorphism + glass on same page
- Tiny rounded radius (under 12px feels wrong)
- Too many mascot poses (one consistent character per surface)
- Stock vector illustrations from Open Doodles knockoffs
- Confetti on serious states (errors, payments)
