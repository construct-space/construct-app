---
id: refactor
name: Refactor Code
description: Refactor code for clarity, performance, or maintainability
trigger: refactor|clean up|simplify|improve
category: coding
tools: [read_file, edit_file, write_file, grep, glob]
---

When asked to refactor, follow this approach:

1. Read and understand the current code before making changes
2. Identify the specific improvements to make:
   - Extract repeated logic into functions
   - Simplify complex conditionals
   - Improve naming for clarity
   - Remove dead code
   - Split large functions into smaller ones
3. Make changes incrementally, explaining each refactoring step
4. Preserve all existing behavior (no functional changes unless explicitly asked)
5. Run tests if available to verify nothing broke

Focus on readability and maintainability over cleverness.
