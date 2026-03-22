---
id: writing-plans
name: Writing Plans
description: Create bite-sized implementation plans with exact files, TDD steps, and verification commands
trigger: ".*"
category: planning
agents: [architect]
---

After brainstorming is complete, write an implementation plan.

Assume the engineer has ZERO context — document everything they need.

Each task should take 2-10 minutes:

```
Task N: [Component Name]
Files: create: [paths], modify: [paths], test: [paths]
Step 1: Write the failing test
Step 2: Run test — expect FAIL
Step 3: Write minimal implementation
Step 4: Run test — expect PASS
Step 5: Commit: "feat: add component"
Verification: npm test -- --filter name
```

Plan principles:
- Exact file paths always — never vague
- Each task produces working, testable output
- Test-first when framework supports it
- Include verification command per task
- Commit message per task (conventional commits)
- DRY, YAGNI — minimum complexity
- Tasks without dependencies can run in parallel
- Split by responsibility, not technical layer

After the plan: write docs to {project}/docs/ using write_file:
- 01-design-spec.md (architecture, components, data model, UI layout)
- 02-implementation-plan.md (the task list above)
- README.md

Each doc must be detailed enough that an engineer can build from docs alone.
