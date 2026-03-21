---
id: project-stats
name: Project Stats
description: Get file count, line count, and size stats for the current project
command: |
  echo "Directory: $(pwd)"
  echo ""
  echo "Files by type:"
  find . -type f -not -path '*/node_modules/*' -not -path '*/.git/*' -not -path '*/dist/*' -not -path '*/.nuxt/*' -not -path '*/.next/*' -not -path '*/target/*' | sed 's/.*\.//' | sort | uniq -c | sort -rn | head -20
  echo ""
  echo "Total files: $(find . -type f -not -path '*/node_modules/*' -not -path '*/.git/*' -not -path '*/dist/*' | wc -l | tr -d ' ')"
  echo "Total lines: $(find . -type f -name '*.ts' -o -name '*.js' -o -name '*.vue' -o -name '*.go' -o -name '*.rs' -o -name '*.py' | grep -v node_modules | grep -v .git | xargs wc -l 2>/dev/null | tail -1 | awk '{print $1}')"
  echo "Disk usage: $(du -sh . --exclude=node_modules --exclude=.git 2>/dev/null || du -sh . 2>/dev/null | head -1)"
workdir: project
timeout: 15
---

Use this tool to get a quick overview of the project's size and composition.
Shows file type distribution, total file count, line count of source files, and disk usage.
Excludes node_modules, .git, dist, and build directories.
