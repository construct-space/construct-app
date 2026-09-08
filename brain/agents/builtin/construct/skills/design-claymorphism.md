---
id: design-claymorphism
name: Claymorphism
description: Playful 3D-clay aesthetic — rounded chunky shapes, soft inner glow, double drop-shadow, bright pastel palette. Reference: Duolingo, modern edtech, kids apps.
triggers: ["claymorphism", "clay", "playful", "kids app", "edtech", "chunky 3d"]
mode: design-system
surface: web
scope: builder
requires_design_system: false
example_prompt: "Build the onboarding flow in claymorphism."
---

# Claymorphism

## 1. Atmosphere
Bright, friendly, tactile. Surfaces feel like rounded clay pieces — chunky, soft, optimistic. Lives between flat design and full skeumorphism. Best on edtech, kids products, gamified flows, onboarding.

## 2. Color
- `surface: #FFF4E6` or `#F0F9FF` — warm or cool pastel canvas
- `card-1: #FDE68A` (sunshine), `card-2: #FECACA` (blush), `card-3: #BFDBFE` (sky), `card-4: #BBF7D0` (mint)
- `text: #1F2937`
- `accent: #6366F1` or `#F97316` — chunky CTAs

Each card type gets its own color from the pastel palette — that's the system.

## 3. Typography
- Rounded sans: Nunito, Quicksand, Lexend, or DM Sans
- Scale: `14 / 16 / 18 / 24 / 36 / 56`
- Weights: 600 / 700 / 800 — text wants to feel chunky too
- Generous line-height 1.6 on body

## 4. Spacing & Grid
- 8pt baseline
- Generous padding inside cards: `p-8` minimum
- Cards are big and few — 2–3 per row max

## 5. Layout
- Hero-first, lots of vertical breathing room
- Floating mascot illustrations or oversized emoji welcome
- Cards arranged with intentional slight rotation (`rotate(-1deg)` on every other) for personality

## 6. Components
- Card: `rounded-3xl` (28px+), pastel fill, **double shadow**:
  - inner highlight: `inset 0 2px 0 rgba(255,255,255,0.7)`
  - outer drop: `0 12px 24px rgba(0,0,0,0.08)`
- Button: chunky pill, solid fill, hard offset shadow `0 6px 0 darker-shade`, presses down on click
- Input: `rounded-2xl` `bg-white` with soft inner shadow
- Icon containers: rounded squares with accent fill

## 7. Motion
- Bouncy — `cubic-bezier(0.34, 1.56, 0.64, 1)`
- Press animation on buttons mandatory (translateY 4px + shadow shrink)
- Card hover: gentle scale 1.02 + shadow grow
- Mascot characters can wiggle/breathe at 4–8s intervals

## 8. Voice
- Warm, encouraging: "Let's go!", "You got it.", "Nice work."
- Title case on CTAs, sentence case on body
- Emoji allowed and encouraged in moderation
- Exclamation marks: yes, but not every sentence

## 9. Anti-patterns
- Sharp corners (any radius < 16px)
- Muted/grayscale palette — clay wants color
- Dense information layouts (data tables, dashboards)
- Serif typography
- Premium-luxury tone — wrong vibe entirely
- Single-color page — needs the multi-pastel pop
- Heavy realistic photography
