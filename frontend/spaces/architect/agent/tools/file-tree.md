---
id: file-tree
name: File Tree
description: Generate a visual file tree of the project structure
parameters:
  - name: path
    type: string
    description: Path to the directory to scan
    required: true
  - name: depth
    type: string
    description: Maximum depth to scan (default 3)
command: |
  cd {{path}} 2>/dev/null || { echo "Directory not found: {{path}}"; exit 1; }
  MAX_DEPTH={{depth}}
  if [ -z "$MAX_DEPTH" ] || [ "$MAX_DEPTH" = "''" ]; then MAX_DEPTH=3; fi
  if command -v find &>/dev/null; then
    find . -maxdepth "$MAX_DEPTH" -not -path '*/node_modules/*' -not -path '*/.git/*' -not -path '*/dist/*' -not -path '*/.nuxt/*' -not -path '*/target/*' -not -path '*/.next/*' | sort | head -200
  else
    ls -R . 2>/dev/null | head -200
  fi
workdir: home
timeout: 10
---

Use this tool to understand the project structure before making architecture decisions.
The file tree helps identify existing patterns, naming conventions, and directory organization.
