---
id: detect-framework
name: Detect Framework
description: Detect the framework and tech stack of a project by examining its files
parameters:
  - name: path
    type: string
    description: Path to the project root directory
    required: true
command: |
  cd {{path}} 2>/dev/null || { echo "Directory not found: {{path}}"; exit 1; }
  echo "{"
  echo "  \"path\": \"$(pwd)\","

  # Package manager
  if [ -f "bun.lockb" ]; then echo "  \"packageManager\": \"bun\","
  elif [ -f "pnpm-lock.yaml" ]; then echo "  \"packageManager\": \"pnpm\","
  elif [ -f "yarn.lock" ]; then echo "  \"packageManager\": \"yarn\","
  elif [ -f "package-lock.json" ]; then echo "  \"packageManager\": \"npm\","
  elif [ -f "go.mod" ]; then echo "  \"packageManager\": \"go\","
  elif [ -f "Cargo.toml" ]; then echo "  \"packageManager\": \"cargo\","
  elif [ -f "requirements.txt" ] || [ -f "pyproject.toml" ]; then echo "  \"packageManager\": \"pip\","
  fi

  # Framework detection
  if [ -f "nuxt.config.ts" ] || [ -f "nuxt.config.js" ]; then echo "  \"framework\": \"nuxt\","
  elif [ -f "next.config.js" ] || [ -f "next.config.mjs" ]; then echo "  \"framework\": \"next\","
  elif [ -f "vite.config.ts" ] || [ -f "vite.config.js" ]; then echo "  \"framework\": \"vite\","
  elif [ -f "angular.json" ]; then echo "  \"framework\": \"angular\","
  elif [ -f "svelte.config.js" ]; then echo "  \"framework\": \"svelte\","
  elif [ -f "Cargo.toml" ]; then echo "  \"framework\": \"rust\","
  elif [ -f "go.mod" ]; then echo "  \"framework\": \"go\","
  elif [ -f "pubspec.yaml" ]; then echo "  \"framework\": \"flutter\","
  fi

  # Language
  if [ -f "tsconfig.json" ]; then echo "  \"language\": \"typescript\","
  elif [ -f "package.json" ]; then echo "  \"language\": \"javascript\","
  elif [ -f "go.mod" ]; then echo "  \"language\": \"go\","
  elif [ -f "Cargo.toml" ]; then echo "  \"language\": \"rust\","
  elif [ -f "pyproject.toml" ] || [ -f "setup.py" ]; then echo "  \"language\": \"python\","
  fi

  echo "  \"detected\": true"
  echo "}"
workdir: home
timeout: 10
---

Use this tool to detect what framework and tech stack a project uses.
Examines config files like package.json, tsconfig.json, go.mod, Cargo.toml etc.
Call this when adding a new project or when the framework field is missing.
