---
id: builder-game
name: Game Development
description: Build browser, mobile, desktop, Flutter, Godot, or engine-based games with rules, rendering, input, physics, assets, scoring, levels, or playtesting
trigger: "game,html game,browser game,canvas,phaser,pixi,three,flutter game,flame,godot,unity,unreal,physics,levels,sprites,score"
category: construct
---

# Game Development

Choose the engine before writing gameplay code. The right engine is part of the implementation, not a cosmetic preference.

## Engine Options

For **HTML/browser games**:

- Canvas 2D: simple arcade, puzzles, grid games, tiny dependency footprint.
- SVG/DOM: board games, card games, UI-heavy interactions.
- PixiJS: sprite-heavy 2D, particles, animation, WebGL rendering.
- Phaser: platformers, tilemaps, scenes, input, arcade physics, levels.
- Three.js: 3D scenes, cameras, lighting, 3D interaction.
- Matter.js/Planck.js: add when physics is the core mechanic.

For **Flutter games**:

- Flame for most 2D Flutter games.
- Flame + Forge2D when Box2D-style physics matters.

For **Godot**:

- Use when the user asks for Godot, native desktop/mobile export, editor-authored scenes, serious 2D/3D, or a project intended to continue in the Godot editor.
- If current Godot version/plugin/export facts matter, research first instead of relying on memory.

For **Unity/Unreal**:

- Mention only when the user asks, the repo already uses them, or the target is a serious 3D/native production workflow.

If the user says “HTML game” and no engine is chosen, present 2-3 options with one recommendation. If the request is small and execution-oriented, choose the simplest viable default and state the assumption.

## Implementation Rules

- Use an existing game/physics engine for established rules, collision, scenes, or AI unless the user asks for from-scratch.
- Define the core loop: input → update → collision/rules → render → score/state.
- Keep game state separate from rendering where practical.
- Add restart, pause, win/lose, score, and basic settings when users would expect them.
- Use real or generated bitmap assets for websites/games unless the style calls for simple vector primitives.

## Verification

- Build/typecheck/test where available.
- Run the game.
- Verify the canvas/scene is nonblank, framed correctly, and updates over time.
- Play one normal path and one edge path: restart, collision, game over, level complete, or invalid move.
