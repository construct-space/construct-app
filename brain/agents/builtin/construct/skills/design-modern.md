---
id: design-modern
name: Modern Tech
description: Contemporary SaaS / dev-tool aesthetic — neutral palette with one bold accent, gradient hero, soft shadows, generous use of subtle glow. Reference: Vercel, Linear, Stripe, Resend.
triggers: ["modern", "tech startup", "saas", "dev tool", "stripe-like", "vercel-like", "linear-like"]
mode: design-system
surface: web
scope: builder
requires_design_system: false
example_prompt: "Build the marketing site in the modern tech system."
---

# Modern Tech

## 1. Atmosphere
Polished, contemporary, technical-but-approachable. Hero has a hint of gradient glow; body sections are clean and structured; CTAs feel inevitable. Pace is brisk but unhurried. Optimized for B2B trust + developer credibility.

## 2. Color
- `surface: #FFFFFF` (or `#0A0A0A` for dark mode — both work)
- `text: #0F172A`
- `ink-500: #64748B`
- `accent: #6366F1` (indigo) or `#10B981` (emerald) or `#2563EB` (blue) — one
- `accent-soft: rgba(99, 102, 241, 0.1)` — for tinted backgrounds
- `border: #E2E8F0`
- `gradient-hero`: `linear-gradient(135deg, accent 0%, accent-end 100%)` — for hero glow only

## 3. Typography
- Sans: Inter, Söhne, Geist, or Untitled Sans
- Scale: `14 / 16 / 18 / 24 / 36 / 56`
- Weights: 400 / 500 / 600 / 700
- Display tracking tight `-0.025em`
- Mono for code: JetBrains Mono, Geist Mono, Fira Code

## 4. Spacing & Grid
- 8pt baseline
- Container `max-w-7xl` with `px-6` mobile / `px-8` desktop
- Section rhythm 96–128px
- Feature grids: 3-col on desktop, 1-col mobile, 24–32px gaps

## 5. Layout
- Hero: large headline + subhead + dual CTA (primary + secondary) + optional radial gradient glow behind
- Feature sections alternate left/right image-text layout
- Stat strip ("trusted by", numbers) is fine if real
- Code blocks as design elements — show product, don't just describe

## 6. Components
- Button primary: solid accent, white text, `rounded-lg`, subtle inner highlight
- Button secondary: `bg-white border-border` or ghost
- Card: white surface, `border + shadow-sm`, `rounded-xl`, generous `p-6+`
- Input: `border + rounded-lg`, accent focus ring
- Nav: top-bar with logo + links + dual CTA, often sticky-blur

## 7. Motion
- 200–300ms ease-out
- Hover states: subtle lift (translateY -1px) + shadow increase
- Scroll-reveal: fade + 8–16px translateY, staggered
- Gradient orb behind hero can drift slowly (8s+ loop, low opacity)

## 8. Voice
- Sentence case on body, Title Case on primary CTAs
- Direct and concrete: "Start building", "Deploy in seconds", "Made for teams"
- Mention real numbers when you have them (latency, uptime, customer count)
- Avoid "revolutionary", "next-gen", "leverage"

## 9. Anti-patterns
- Multiple accent colors competing
- Heavy decorative imagery (3D blobs everywhere)
- Glassmorphism on form controls (kills usability)
- Stock illustrations of abstract people
- Drop shadows on every element
- Animation on every scroll element (motion fatigue)
- "We are the best" copy without proof
- Trust badge rows of unrelated logos
