---
id: design-review
name: Design Review
description: One-shot grader. Read a generated page or artifact and return a punch list of design issues — hierarchy, contrast, type, spacing, motion, voice, anti-patterns.
triggers: ["design review", "review the design", "grade this ui", "is this good", "critique"]
mode: heuristic
surface: any
scope: any
requires_design_system: true
example_prompt: "Run design-review on /inventory."
---

# Design Review — one-shot grader

Load this skill **after** you've generated something. Read the artifact (HTML, screenshot, or rendered page) and grade it. Output is a punch list: what's broken, ranked by severity. Never compliments. The model's job is to find issues, not validate.

## Read the brief first

Open `DESIGN.md` if it exists. If it doesn't, ask: "Do you want me to grade against generic web-design heuristics or write the brief first?" Don't grade in a vacuum — half the issues that look wrong are actually brand-correct, and you'll grade them wrong.

## Pass 1 — Hierarchy (most important)

Stand back. Can you tell, in 1 second, what the page is *for*? What's the primary action?

- One H1 per page, and it must dominate.
- Primary CTA visually outranks secondary actions by color, size, *and* position. Never just one.
- Headline → support → action. If the eye lands on the support copy first, the size ramp is wrong.
- Cards/sections should have one focal point each, not three.

## Pass 2 — Color & contrast

- Body text vs. background: **WCAG AA** at minimum (4.5:1). Test against the lightest *and* darkest bg this text appears on.
- Primary CTA contrast against page bg ≥ 3:1.
- Off-palette colors (anything not in the brief's section 2): flag every one.
- Same color doing two different jobs (text + decoration + status) is a smell.

## Pass 3 — Typography

- More than two families? Flag.
- More than four weights actually used? Flag.
- Line-height < 1.4 on body text? Flag.
- Headings line-length over 12 words? Wrap or rewrite.
- Body line-length: 60–80 characters. Outside that range → flag.

## Pass 4 — Spacing & rhythm

- Are all gaps on the 4/8pt grid, or are there one-off `13px` and `27px` values? Flag drift.
- Vertical rhythm between sections: same `section-y` everywhere? If not, you have arbitrary spacing.
- Card padding consistent across card types? If a "small card" and "feature card" have visibly different internal padding *and there's no reason*, flag.

## Pass 5 — Components

- Buttons: hover, focus-visible, active, disabled, loading. List which are missing.
- Inputs: visible focus ring? Error state? Label position consistent?
- Cards: pick *one* — border OR shadow OR ring. Two is loud.
- Radii consistent within a family (don't mix `rounded-md` and `rounded-2xl` on similar elements).

## Pass 6 — Motion

- Transitions ≤ 300ms unless intentional.
- One easing curve per direction (in / out), not five.
- Hover scales > 1.05 on cards: flag (looks cheap).
- Anything autoplay-bouncing: flag.

## Pass 7 — Voice

- Microcopy consistent in tone? Spot the one button that doesn't match.
- Lorem ipsum, "Acme Inc.", placeholder URLs anywhere? Hard fail.
- Capitalization rule held? (Sentence case mixed with Title Case in buttons is the most common drift.)
- Forbidden words from the brief actually absent?

## Pass 8 — Anti-patterns from the brief

For every entry in `DESIGN.md` section 9: did we ship it anyway? List each violation.

## Output shape

```
Hierarchy: <items, severity 1–3>
Color & contrast: <items>
Typography: <items>
Spacing: <items>
Components: <items>
Motion: <items>
Voice: <items>
Anti-patterns: <items>

Top 3 to fix first: <numbered>
Brand-correct, not a bug: <items the agent almost flagged but the brief permits>
```

Severity 1 = breaks the page (illegible, broken contrast, missing CTA). Severity 2 = looks unfinished. Severity 3 = nit.

Stop at the punch list. Do **not** fix anything in the same turn — the user picks what to fix.
