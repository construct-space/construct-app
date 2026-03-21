---
id: run-command
name: Run Command
description: Run a shell command in the project directory and return the output
parameters:
  - name: command
    type: string
    description: The shell command to execute
    required: true
command: |
  {{command}}
workdir: project
timeout: 30
---

Use this tool to run arbitrary shell commands in the project directory.
Common uses: running tests, starting dev servers, installing packages, git operations.
Always check the output for errors before proceeding.
