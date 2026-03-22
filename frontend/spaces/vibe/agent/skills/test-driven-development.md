---
id: test-driven-development
name: Test-Driven Development
description: Red-green-refactor — write failing test first, then implement
trigger: test,tdd,spec
category: execution
agents: [vibe]
---

When the project has a test framework, follow RED-GREEN-REFACTOR:

1. RED: Write a failing test for the feature/fix
2. Verify it FAILS with the expected error (not a different error)
3. GREEN: Write MINIMAL code to pass the test
4. Verify it PASSES
5. REFACTOR: Clean up if needed, re-run tests

IRON LAW: No production code without a failing test first (when tests exist).
Skip only when: no test framework, pure config changes, or user says skip.
