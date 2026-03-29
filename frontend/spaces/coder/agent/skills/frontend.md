---
name: frontend
description: Build distinctive, production-grade frontend interfaces. Triggers when the coder needs to create web pages, components, or applications. Emphasizes design quality and avoids generic AI aesthetics.
---

Build distinctive, production-grade frontend interfaces with exceptional attention to design. This skill applies when creating landing pages, web apps, dashboards, or any user-facing interface.

## Before Coding

Understand context and commit to a clear aesthetic direction:
- **Purpose**: What does this solve? Who uses it?
- **Tone**: Pick a direction and commit fully. Brutally minimal, maximalist, retro-futuristic, luxury/refined, playful, editorial, brutalist, art deco, soft/pastel, industrial. Don't be generic.
- **Differentiation**: What makes this memorable? What's the one thing someone will remember?

Bold maximalism and refined minimalism both work. The key is intentionality, not intensity.

## Tooling

- **Use `bun` for everything** — init, install, run, build, test. Not npm, not yarn.
  - `bun init` to scaffold
  - `bun add` to install deps
  - `bun run dev` to start dev server
  - `bun run build` to build
  - `bunx` instead of `npx`
- **Vite** for dev server and builds
- **Tailwind CSS** for styling (unless the project specifies otherwise)
- When building for an existing project, match its stack. Don't introduce new tools.

## Design Standards

### Typography
Choose distinctive fonts. Avoid Arial, Inter, system-ui defaults. Pair a characterful display font with a refined body font. Google Fonts is fine — use `@import` or `<link>`.

### Color & Theme
Commit to a cohesive palette. Use CSS variables. Dominant colors with sharp accents beat timid, evenly-distributed palettes. Dark and light modes when appropriate.

### Motion
Focus on high-impact moments: one well-orchestrated page load with staggered reveals creates more delight than scattered micro-interactions. Use CSS transitions and animations first. Scroll-triggered effects and hover states that surprise.

### Spatial Composition
Unexpected layouts. Asymmetry. Overlap. Grid-breaking elements. Generous negative space OR controlled density — pick one and commit.

### Visual Details
Create atmosphere — don't default to solid white/gray backgrounds. Gradient meshes, subtle textures, geometric patterns, layered transparencies, dramatic shadows, decorative borders, grain overlays. Match the overall aesthetic direction.

### Avoid
- Generic "AI look" — predictable purple/blue gradients, centered hero with stock photo, cookie-cutter card grids
- Bootstrap/template aesthetics — if it looks like a template, it IS a template
- Timid design — half-committed styling that looks like a wireframe
- Over-engineering — match complexity to the project scope

## Implementation

- Write real, working, production-grade code
- Mobile-responsive by default
- Semantic HTML with proper accessibility (alt text, labels, ARIA where needed)
- Clean component structure — one purpose per component
- Images: use Unsplash URLs, placeholder SVGs, or CSS-generated visuals. Never broken image links.
- Forms: proper validation, focus states, error states
- When the project has docs (requirements, UI spec), follow them exactly

## Construct-Specific

When building inside a Construct space (not a standalone project):
- Framework is always Vue 3 + Composition API + `<script setup>`
- UI components from `@construct-space/ui`
- Styling with Tailwind + Construct theme CSS variables (`--app-foreground`, `--app-background`, `--app-accent`, `--app-muted`, `--app-border`)
- Host APIs from `@construct-space/sdk`
- Don't install frameworks — they're already provided by the host app
