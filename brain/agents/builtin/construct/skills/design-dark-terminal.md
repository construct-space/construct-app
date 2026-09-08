---
id: design-dark-terminal
name: Dark Terminal
description: Hacker-aesthetic dark canvas with monospace type, neon accent (green/amber/cyan), grid backgrounds, cursor blinks. Reference: Vercel CLI, Warp, retro CRT.
triggers: ["terminal", "hacker", "cli", "monospace design", "matrix", "neon dark", "dev tool dark"]
mode: design-system
surface: web
scope: builder
requires_design_system: false
example_prompt: "Build the developer landing page in dark terminal."
---

# Dark Terminal

## 1. Atmosphere
Sharp, technical, slightly retrofuturist. Dark canvas, monospace headlines, neon accents, faint grid lines. Conveys "this is for engineers". Best for dev tools, CLIs, infrastructure products.

## 2. Color
- `surface: #0A0A0A` or `#0F1117`
- `surface-2: #15171E`
- `text: #E5E7EB`
- `ink-500: #6B7280`
- `accent-green: #00FF88` or `#34D399` (Matrix / Vercel-ish)
- `accent-amber: #FFB020` (CRT amber)
- `accent-cyan: #22D3EE`
- `border: rgba(255,255,255,0.08)`

Pick **one** neon accent. Two competing neons looks chaotic.

## 3. Typography
- Display: monospace — JetBrains Mono, IBM Plex Mono, Berkeley Mono, Geist Mono
- Body: same mono, or paired with Inter for prose
- Scale: `13 / 14 / 16 / 20 / 32 / 48`
- Weights: 400 / 500 / 700
- Tabular numerals always

## 4. Spacing & Grid
- 8pt baseline
- Subtle background grid (`bg-grid` SVG, ~1% opacity)
- Containers `max-w-6xl` with `px-6`
- Sections 96–128px vertical

## 5. Layout
- Hero shows a terminal panel as the protagonist (cursor blinking, faux CLI output)
- ASCII art or wireframe SVG accents acceptable
- Code blocks as primary content — show, don't tell
- Stats and status indicators ("● Online", "$ deploy --prod")

## 6. Components
- Buttons: rectangle, `border: 1px solid accent`, transparent fill, accent on hover
- Cards: dark surface, hairline border, accent-glow on hover (`box-shadow: 0 0 24px accent/20%`)
- Inputs: `bg-surface-2`, accent caret + focus border
- Nav: top bar with logo + monospace links + status indicator

## 7. Motion
- Cursor blink (1s, step-end)
- Type-on text effects for headlines (optional, never autoplay > once)
- Glow pulse on accent CTAs (slow 2–3s)
- Transitions sharp: 100–150ms ease-linear

## 8. Voice
- Sentence case or all-lowercase
- Technical, declarative: "ship in seconds", "zero-config deploys"
- Code-style copy fragments: `$ install`, `→ build`, `✓ deployed`
- No marketing fluff — engineers will close the tab

## 9. Anti-patterns
- Pastel palette anywhere
- Multiple neons fighting each other
- Decorative 3D illustrations
- Serif headlines
- Stock photography of developers
- Light mode with monospace — it just looks like a code editor, not a brand
- Glassmorphism on terminal surfaces (wrong texture)
- Rounded corners > 8px
