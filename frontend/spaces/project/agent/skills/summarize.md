---
id: summarize-project
name: Summarize Project
description: Generate a concise summary of the current project
trigger: summarize|overview|what is this project
category: project
tools: [read_file, list_dir, glob]
---

Read the project's README, package.json (or equivalent), and top-level directory structure. Then provide a concise summary covering:

1. What the project does
2. Tech stack and key dependencies
3. Project structure (main directories and their purpose)
4. How to run it (dev, build, test commands)

Keep the summary under 500 words. Focus on what a new developer needs to know.
