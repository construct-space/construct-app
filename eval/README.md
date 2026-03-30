# Construct Eval Harness

GEPA-powered optimization for Operator agent prompts and skills.

GEPA (Genetic-Pareto) evolves textual parameters — agent configs, skill files — by running them against real tasks, capturing execution traces, and using LLM reflection to propose targeted improvements.

## Setup

```bash
./setup.sh
```

Installs Python 3.12 (via brew), creates a `.venv`, installs `gepa[full]` and dependencies.

Requires Operator running on `:60100`.

## Scripts

| Script | What it does |
|--------|-------------|
| `./setup.sh` | Install Python, venv, deps |
| `./eval.sh` | Score current params (no optimization) |
| `./optimize.sh` | Run GEPA evolutionary optimization |
| `./apply.sh` | Apply optimized result to skill/config file |

## Usage

### Evaluate current skills

```bash
./eval.sh --param coder_skill_frontend
./eval.sh --param coder_config --tasks landing_page
```

### Optimize

```bash
# Default: 10 generations, population 5
./optimize.sh --param coder_skill_frontend

# Targeted: specific task, fewer generations
./optimize.sh --param coder_config --tasks landing_page --generations 5

# Full sweep
./optimize.sh --param coder_skill_frontend --generations 20 --population 8
```

### Apply result

```bash
# List available results
./apply.sh

# Apply best candidate (backs up original automatically)
./apply.sh --param coder_skill_frontend --apply results/best_coder_skill_frontend_20260330.md
```

## Optimizable Parameters

| Param | File | What it controls |
|-------|------|-----------------|
| `coder_config` | `spaces/coder/agent/config.md` | Coder agent system prompt |
| `coder_skill_frontend` | `spaces/coder/agent/skills/frontend.md` | Frontend building skill |
| `coder_skill_spaces` | `spaces/coder/agent/skills/construct-spaces.md` | Construct space building skill |
| `architect_config` | `spaces/architect/agent/config.md` | Architect agent system prompt |
| `brainstorm_config` | `spaces/brainstorm/agent/config.md` | Brainstorm agent system prompt |

## How It Works

```
GEPA mutates skill .md text (the "candidate")
  -> harness scaffolds temp workspace with task files
    -> sends task to Operator via TCP :60100
      -> agent runs full tool loop (read, write, bash, etc.)
        -> harness captures RunResult (turns, tool calls, errors, tokens)
          -> metrics score the output
            -> diagnostic text becomes ASI (Actionable Side Information)
              -> GEPA reflects on WHY it scored that way
                -> proposes targeted mutation -> repeat
```

The key: metrics return **diagnosis text**, not just scores. When a file is missing or a section is absent, the diagnosis explains what the agent did wrong. GEPA's reflection LLM reads this and knows exactly what to fix in the prompt.

## Eval Tasks

Tasks live in `tasks/*.yaml`. Each defines:

- **prompt** — what the agent is asked to build
- **scaffold** — files created before the agent runs (docs, package.json)
- **metrics** — success criteria with weights

### Adding a task

```yaml
id: my_task
name: "Build a widget"
agent: coder
category: frontend

prompt: |
  Build a date picker component...

scaffold:
  docs/plan.md: |
    # Date Picker
    ## Stack: Vue 3 + TypeScript

metrics:
  - id: component_exists
    check: file_exists
    args: { path: "src/DatePicker.vue" }
    weight: 0.5
  - id: has_types
    check: content_contains_all
    args:
      path: "src/DatePicker.vue"
      patterns: ["defineProps", "ref"]
    weight: 0.3
  - id: token_efficiency
    check: token_budget
    args: { max_input: 40000, max_output: 12000 }
    weight: 0.2
```

### Available metrics

| Metric | What it checks |
|--------|---------------|
| `file_exists` | File was created |
| `file_min_lines` | File is substantial, not a stub |
| `content_contains_all` | All patterns present |
| `content_contains_any` | At least one pattern present |
| `content_matches_regex` | Regex match |
| `token_budget` | Under token limit |
| `max_turns` | Completed within turn budget |
| `build_succeeds` | Build command exits 0 |

## Structure

```
eval/
├── setup.sh               # install deps
├── eval.sh                # evaluate current params
├── optimize.sh            # run GEPA optimization
├── apply.sh               # apply results
├── harness.py             # core: workspace -> Operator -> trace -> metrics
├── metrics.py             # scoring functions (return score + diagnosis)
├── gepa_adapter.py        # maps Operator params to GEPA interface
├── run_optimization.py    # CLI entry point
├── tasks/                 # eval task definitions
│   ├── landing_page.yaml
│   └── vue_component.yaml
└── results/               # saved optimization outputs (gitignored)
```

## Operator Integration

The harness talks to Operator via TCP on `:60100` using the same protocol the frontend uses. One thing to wire up: skill override injection in `operator/internal/runner/runner.go` at the skill matching block (~line 193) so GEPA candidates are used instead of the on-disk skill files during optimization runs.
