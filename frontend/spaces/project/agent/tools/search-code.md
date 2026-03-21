---
id: search-code
name: Search Code
description: Search for a pattern across project source files using ripgrep or grep
parameters:
  - name: pattern
    type: string
    description: Regex pattern to search for
    required: true
  - name: file_type
    type: string
    description: File extension filter (e.g. ts, vue, go, rs)
command: |
  if command -v rg &>/dev/null; then
    if [ -n "{{file_type}}" ] && [ "{{file_type}}" != "''" ]; then
      rg --type {{file_type}} -n --no-heading {{pattern}} . 2>/dev/null | head -50
    else
      rg -n --no-heading {{pattern}} . 2>/dev/null | head -50
    fi
  else
    if [ -n "{{file_type}}" ] && [ "{{file_type}}" != "''" ]; then
      grep -rn --include="*.{{file_type}}" {{pattern}} . 2>/dev/null | head -50
    else
      grep -rn --exclude-dir=node_modules --exclude-dir=.git {{pattern}} . 2>/dev/null | head -50
    fi
  fi
workdir: project
timeout: 15
---

Use this tool to search for code patterns across the project.
Prefers ripgrep (rg) if available, falls back to grep.
Results are limited to 50 matches. Use file_type to narrow results.
