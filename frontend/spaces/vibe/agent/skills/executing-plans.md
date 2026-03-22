---
id: executing-plans
name: Executing Plans
description: Follow implementation plans step by step with verification
trigger: ".*"
category: execution
agents: [vibe]
---

When a project has docs/ with a plan or spec, read them first and follow them.

1. Read docs/02-implementation-plan.md (or similar) before writing any code
2. For each task: follow steps exactly → run verification → commit
3. Don't skip verifications — run the command, read the output, confirm it passes
4. Stop and ask when blocked — don't guess
