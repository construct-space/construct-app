---
id: design-brief
name: Design Brief
description: Author or read a project DESIGN.md — the 9-section visual contract that pins atmosphere, color, type, spacing, components, motion, voice, and anti-patterns.
triggers: ["design brief", "design.md", "visual contract", "brand system", "pin the design"]
mode: design-system
surface: any
scope: any
requires_design_system: false
example_prompt: "Write a DESIGN.md for this project based on the existing pages."
---

# Design Brief — DESIGN.md rubric

Every project that ships UI deserves a `DESIGN.md`. Without it, every new turn re-improvises color, type, spacing — the artifact looks different on Tuesday than it did on Monday. The brief locks the contract once so subsequent work *iterates* the brand instead of re-inventing it.

Drop `DESIGN.md` at the repo root. Use these nine sections, in this order, every time.

## 1. Visual Theme & Atmosphere
One paragraph. What does this *feel* like — editorial, brutalist, premium, playful, technical? Pick one and commit. List one or two reference brands the visual language is closest to (Stripe, Linear, The Verge, …). This section is the north star — if a later decision contradicts it, the decision is wrong.

## 2. Color
Hex tokens, named:
- `primary` — main accent for CTAs and key emphasis
- `surface` — page/canvas background
- `text` — body color
- `ink-50…ink-900` — neutral ramp
- `success`, `warning`, `danger` — semantic
- (optional) `secondary`, `accent-soft`, `surface-warm`

State which is the **interaction color** (the one that says "click me") and what backgrounds it lives on. List one or two color **anti-pairings** (e.g. "never put primary on warning").

## 3. Typography
- Scale (px): six steps, e.g. `14 / 16 / 18 / 24 / 32 / 48`
- Families: `primary`, `display`, optionally `mono`
- Weights actually used (not the whole 100–900 ramp)
- Heading rule: which steps map to h1/h2/h3, line-height for each

Pick **two families maximum**. Three is a smell.

## 4. Spacing & Grid
- Baseline: 4pt or 8pt
- Container max-width and gutter
- Vertical section rhythm (`section-y` token)
- Card / form-control internal padding

## 5. Layout & Composition
- Page archetypes (marketing landing vs. dashboard vs. detail)
- Hierarchy rule: headline → support → primary CTA, never flatten
- Whitespace before borders before shadows — earn each layer
- Image treatment (aspect ratios, crop alignment, overlay rules)

## 6. Components
- Button: primary / secondary / ghost states, focus-visible rule, radius
- Input: label position, error pattern, focus ring
- Card: radius, elevation strategy, border vs. shadow
- Nav: sticky vs. static, active-state rule

## 7. Motion & Interaction
- Default duration (150–250ms is usually right)
- Easing (one curve for entrances, one for exits)
- Hover, focus-visible, active, disabled, loading — all explicit
- Page transitions (or none — that's a valid stance)

## 8. Voice & Brand
- Microcopy tone: concise/playful/formal/technical — pick one
- Capitalization: Sentence case or Title Case on actions (pick)
- Forbidden words: "leverage", "synergy", lorem ipsum
- Language: en / sq / multi — and if multi, default and switcher rule

## 9. Anti-patterns
List 5–10 things that would break the brand:
- Off-palette colors when a token would do
- Three weights in one heading
- Decorative effects that reduce readability
- Mixed visual metaphors in one screen
- Stock-photo people looking at laptops
- Etc. — be specific to this brand

---

When generating UI, the agent should read `DESIGN.md` first, treat sections 2–4 as hard constraints, and use 1, 8, 9 as taste guardrails. If a request contradicts the brief, surface the conflict before shipping — don't silently drift.
