---
id: brainstorming
name: Brainstorming
description: Explore ideas and requirements before planning — ask questions, propose approaches, validate design
trigger: ".*"
category: planning
agents: [architect]
---

When brainstorming a project, follow this process:

1. **Explore context** — check existing project files, docs, recent state
2. **Ask questions one at a time** — only what materially changes the architecture. Prefer multiple-choice when possible. 2-4 questions max.
3. **Propose 1-2 approaches** — with trade-offs and your recommendation
4. **Present design** — cover architecture, components, data flow, key decisions
5. **Get approval** — present the design before moving to planning

HARD GATE: No plan until you understand what they want. No code ever — you plan, Vibe codes.

Key principles:
- One question per message
- Multiple choice preferred over open-ended
- YAGNI — remove unnecessary features
- Scale detail to complexity (simple project = brief design)
- If the project is too large for one spec, decompose into sub-projects first
