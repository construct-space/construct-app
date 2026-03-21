---
id: explain-code
name: Explain Code
description: Explain how a piece of code or file works
trigger: explain|how does|what does|walk me through
category: coding
tools: [read_file, grep, glob]
---

When asked to explain code, follow this approach:

1. Read the file or code section the user is asking about
2. Identify the purpose and high-level behavior
3. Walk through the logic step by step, explaining:
   - What each section does and why
   - Key data structures and their roles
   - Control flow and edge cases
   - External dependencies and how they're used
4. Highlight any non-obvious patterns or conventions
5. Note potential issues or areas for improvement only if asked

Keep explanations clear and concise. Use the user's skill level to calibrate detail.
