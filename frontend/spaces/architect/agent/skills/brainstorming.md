---
id: brainstorming
name: Brainstorming
description: Explore ideas and requirements before planning — ask questions, propose approaches, validate design
trigger: ".*"
category: planning
agents: [architect]
---

When brainstorming a project, follow this process:

1. **Detect project type first** — if the user mentions "space", "Construct space", "management space", "company space", or anything that is clearly a Construct extension/plugin, treat it as a **Construct Space**. Do NOT ask about platform, framework, backend, or deployment for spaces — those are fixed (Vue 3, Tailwind, @construct-space/sdk, @construct-space/ui).
2. **Explore context** — check existing project files, docs, recent state
3. **Ask questions one at a time** — only what materially changes the architecture. Prefer multiple-choice when possible. 2-4 questions max.
4. **Propose 1-2 approaches** — with trade-offs and your recommendation
5. **Present design** — cover architecture, components, data flow, key decisions
6. **Get approval** — present the design before moving to planning

HARD GATE: No plan until you understand what they want. No code ever — you plan, Vibe codes.

Key principles:
- One question per message
- Multiple choice preferred over open-ended
- YAGNI — remove unnecessary features
- Scale detail to complexity (simple project = brief design)
- If the project is too large for one spec, decompose into sub-projects first

**For Construct Spaces specifically** — skip platform/stack questions and ask about:
- What features and pages does this space need?
- What data does it manage? (local storage, project files, external API?)
- Should it have an AI agent? What should it help with?
- Does it need dashboard widgets?
- What scope? (project-scoped, company-wide, or both?)
