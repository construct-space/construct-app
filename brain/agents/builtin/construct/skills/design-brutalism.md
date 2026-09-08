---
id: design-brutalism
name: Brutalism
description: Raw, defiant, deliberately rough — heavy borders, system fonts, exposed structure, high contrast, no rounded corners. Reference: brutalist web archive, Bloomberg Businessweek.
triggers: ["brutalism", "brutalist", "raw design", "anti-design", "marquee", "system font"]
mode: design-system
surface: web
scope: builder
requires_design_system: false
example_prompt: "Build the launch page in brutalist style."
---

# Brutalism

## 1. Atmosphere
Loud, confrontational, honest. Exposes the bones of the page — borders are thick, hierarchy is shouted, layout is grid-defying. Pretends nothing. Refuses to apologize.

## 2. Color
- `primary: #000000`
- `surface: #FFFFFF` (or `#FFFF00` if you're brave)
- `accent: #FF00FF` or `#00FF00` — one screaming color
- `text: #000000`
- Never use grays softer than `#222`

Two-color pages are correct. Three is permitted. Four is a smell.

## 3. Typography
- System fonts only: `font-family: ui-monospace, "Times New Roman", -apple-system`
- Scale: aggressive — `16 / 16 / 24 / 48 / 96 / 160`
- Weights: 400 and 900, nothing between
- Tracking: tight on display, loose on small caps
- Line-height 1.0 on display, 1.5 on body

## 4. Spacing & Grid
- 0pt baseline — break the grid on purpose
- Containers go edge-to-edge with thick `4px–8px` borders
- Vertical rhythm: jarring shifts, not equal sections

## 5. Layout
- Overlapping elements (text over image, button over headline)
- Marquee scrollers welcome
- Underlined inline links, bright color, no hover-only state
- Footer is louder than the rest of the page

## 6. Components
- Buttons: rectangle, `border: 4px solid black`, no radius, no shadow — or *hard* offset shadow `4px 4px 0 black`
- Cards: same — thick border, hard shadow, no radius
- Inputs: native browser styles, only minimally touched
- Nav: oversized, sticky, possibly rotated

## 7. Motion
- Instant or jarring — 0ms or 500ms+ snap
- Marquee at constant speed
- Cursor effects allowed (oversized, color-inverting)
- Page transitions: cut, no fade

## 8. Voice
- ALL CAPS in headlines is fine
- Casual to confrontational: "BUY IT.", "READ THE THING.", "NO"
- Punctuation as design element ("///" dividers, "→→→" arrows)

## 9. Anti-patterns
- Soft pastel palette
- Rounded corners
- Drop shadows that fade smoothly (use hard offset instead)
- Loading spinners — show a "LOADING" word instead
- Stock illustrations of people
- Tasteful gradients
- "Glass" anything
