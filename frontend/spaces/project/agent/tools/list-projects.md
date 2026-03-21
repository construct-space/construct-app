---
id: list-projects
name: List Projects
description: List all registered projects with their paths and frameworks
command: |
  if [ -n "$CONSTRUCT_DATA_DIR" ] && [ -f "$CONSTRUCT_DATA_DIR/projects.json" ]; then
    cat "$CONSTRUCT_DATA_DIR/projects.json"
  else
    echo '{"projects":[]}'
  fi
workdir: home
timeout: 5
---

Use this tool to see what projects the user has registered in Construct.
Returns JSON with project names, root paths, types, and frameworks.
The CONSTRUCT_DATA_DIR env var is set by the operator at startup, pointing to the OS-native data directory.
