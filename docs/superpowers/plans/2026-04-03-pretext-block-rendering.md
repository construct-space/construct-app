# Pretext Block Rendering — Future Plan

**Date:** 2026-04-03
**Status:** Planned
**Priority:** Medium
**Source:** https://github.com/chenglou/pretext (34k stars, by chenglou)

## Problem

Current conversation rendering uses DOM-based markdown (`marked` + `DOMPurify`) with standard Vue components for blocks (text, tool calls, code, images). Issues:

- **Architect questions flicker** — layout shifts when question blocks render/update
- **Long sessions** (50+ tool calls) cause layout reflow chains during streaming
- **Scroll anchoring** is imprecise — block heights unknown until DOM renders
- **No virtualization** — all blocks are in DOM, even off-screen ones

## Proposed Solution

Replace DOM-based block rendering with Pretext-powered layout engine:

1. **Pretext measures all text blocks** before rendering — heights known upfront
2. **Virtualized block list** — only visible blocks in DOM (O(visible) not O(total))
3. **No layout reflow during streaming** — Pretext calculates dimensions without DOM
4. **Precise scroll anchoring** — exact block positions computed mathematically

## Architecture

```
Stream chunk arrives
  → Update block content (reactive)
  → Pretext.prepare(content, font) → cached segment data
  → Pretext.layout(prepared, containerWidth, lineHeight) → exact height
  → Virtual list positions all blocks by accumulated heights
  → Only blocks in viewport get rendered to DOM
  → Scroll position maintained by computed offsets
```

## Key Benefits

- **Eliminates architect question flicker** — block height known before render
- **Smooth streaming** — no DOM measurement during text delta events
- **Performance at scale** — 100+ blocks virtualized, only ~10-15 in DOM
- **Shrink-wrap** — know exact content width for code blocks, tool results

## Scope

- Conversation block layout (AgentView, RequestBubble, ResponseBlocks)
- Streaming text measurement
- Code block height pre-calculation
- Tool call block sizing
- Image block sizing (known from file metadata)

## Dependencies

- `@chenglou/pretext` npm package
- Clone at `/tmp/pretext` for reference

## Not in Scope (for now)

- Monaco editor replacement
- Canvas-based text rendering (stick with DOM, just use Pretext for measurement)
- Server-side rendering

## Known Issues to Fix First

- Architect questions flickering on render — investigate if this is a layout shift or a reactivity issue before committing to Pretext rewrite
