---
id: git-status
name: Git Status
description: Show git status, recent commits, and current branch
command: |
  echo "=== Branch ==="
  git branch --show-current 2>/dev/null || echo "(not a git repo)"
  echo ""
  echo "=== Status ==="
  git status --short 2>/dev/null || echo "(not a git repo)"
  echo ""
  echo "=== Recent Commits ==="
  git log --oneline -10 2>/dev/null || echo "(no commits)"
workdir: project
timeout: 10
---

Use this tool to understand the current state of the git repository.
Shows the current branch, uncommitted changes, and recent commit history.
Call this before making changes to understand the project's current state.
