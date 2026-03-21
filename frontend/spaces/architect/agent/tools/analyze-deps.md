---
id: analyze-deps
name: Analyze Dependencies
description: Analyze project dependencies and their versions from package files
parameters:
  - name: path
    type: string
    description: Path to the project root directory
    required: true
command: |
  cd {{path}} 2>/dev/null || { echo "Directory not found: {{path}}"; exit 1; }
  echo "{"
  echo "  \"path\": \"$(pwd)\","
  if [ -f "package.json" ]; then
    echo "  \"type\": \"node\","
    echo "  \"dependencies\":"
    cat package.json | grep -A 100 '"dependencies"' | head -50
  elif [ -f "go.mod" ]; then
    echo "  \"type\": \"go\","
    echo "  \"module\": \"$(head -1 go.mod)\","
    echo "  \"requires\":"
    grep -v "^//" go.mod | grep -v "^$" | head -30
  elif [ -f "Cargo.toml" ]; then
    echo "  \"type\": \"rust\","
    echo "  \"dependencies\":"
    cat Cargo.toml | grep -A 50 '\[dependencies\]' | head -30
  elif [ -f "pyproject.toml" ]; then
    echo "  \"type\": \"python\","
    echo "  \"dependencies\":"
    cat pyproject.toml | grep -A 50 'dependencies' | head -30
  else
    echo "  \"type\": \"unknown\""
  fi
  echo "}"
workdir: home
timeout: 10
---

Use this tool to analyze project dependencies before making architecture decisions.
Understanding the dependency graph helps you suggest compatible libraries and avoid version conflicts.
