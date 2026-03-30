"""
GEPA Adapter for Construct Operator.

Maps Operator's textual parameters (agent config.md, skill .md files) to GEPA's
optimization interface. GEPA mutates the text, this adapter evaluates the mutant
by running it through the eval harness, and returns scores + ASI traces.

The key insight: skills and agent configs are just markdown text.
GEPA optimizes text. Perfect fit.
"""

from __future__ import annotations

import os
from pathlib import Path

import gepa

from harness import EvalTask, run_eval, TASKS_DIR, SKILLS_DIR


# ─── Parameter Extraction ───

# These are the textual parameters GEPA will optimize.
# Each is a path to a .md file whose content is the "candidate" GEPA evolves.

OPTIMIZABLE_PARAMS = {
    "coder_config": SKILLS_DIR / "coder" / "agent" / "config.md",
    "coder_skill_frontend": SKILLS_DIR / "coder" / "agent" / "skills" / "frontend.md",
    "coder_skill_spaces": SKILLS_DIR / "coder" / "agent" / "skills" / "construct-spaces.md",
    "architect_config": SKILLS_DIR / "architect" / "agent" / "config.md",
    "brainstorm_config": SKILLS_DIR / "brainstorm" / "agent" / "config.md",
}


def load_param(name: str) -> str:
    """Load the current content of an optimizable parameter."""
    path = OPTIMIZABLE_PARAMS[name]
    return path.read_text() if path.exists() else ""


def load_all_params() -> dict[str, str]:
    """Load all optimizable parameters as {name: content}."""
    return {name: load_param(name) for name in OPTIMIZABLE_PARAMS}


# ─── GEPA Evaluator ───


class ConstructEvaluator:
    """GEPA evaluator that runs Operator agent tasks and scores the results.

    GEPA calls evaluate() with a candidate (mutated skill/config text),
    we run it through Operator, and return scores + ASI diagnostic text.
    """

    def __init__(self, task_ids: list[str] | None = None, param_name: str = "coder_skill_frontend"):
        """
        Args:
            task_ids: Which eval tasks to run. None = all tasks in tasks/ dir.
            param_name: Which parameter this evaluator optimizes.
        """
        self.param_name = param_name
        self.tasks = self._load_tasks(task_ids)

    def _load_tasks(self, task_ids: list[str] | None) -> list[EvalTask]:
        tasks = []
        for f in sorted(TASKS_DIR.glob("*.yaml")):
            task = EvalTask.load(f)
            if task_ids is None or task.id in task_ids:
                tasks.append(task)
        return tasks

    def evaluate(self, candidate: str) -> tuple[float, str]:
        """Evaluate a candidate parameter value.

        Args:
            candidate: The mutated text content (e.g., new frontend.md skill content)

        Returns:
            (score, asi_text): Weighted score [0,1] and diagnostic text for GEPA reflection.
            The ASI text is what makes GEPA powerful — it tells the reflection LLM
            exactly WHY this candidate scored the way it did.
        """
        # Build skill override from the candidate
        skill_overrides = {self.param_name: candidate}

        all_asi = []
        total_score = 0.0

        for task in self.tasks:
            result = run_eval(task, skill_overrides=skill_overrides)
            total_score += result.total_score
            all_asi.append(result.asi_text())

        avg_score = total_score / len(self.tasks) if self.tasks else 0.0
        combined_asi = "\n\n---\n\n".join(all_asi)

        return avg_score, combined_asi


# ─── GEPA Optimization ───


def optimize_param(
    param_name: str = "coder_skill_frontend",
    task_ids: list[str] | None = None,
    generations: int = 10,
    population_size: int = 5,
    model: str = "claude-sonnet-4-6",
) -> gepa.OptimizationResult:
    """Run GEPA optimization on a single Operator parameter.

    This is the main entry point. It:
    1. Loads the current parameter value as the seed candidate
    2. Creates a GEPA evaluator that scores candidates via the eval harness
    3. Runs evolutionary optimization with LLM-based reflection
    4. Returns the best candidate found

    Args:
        param_name: Which parameter to optimize (key from OPTIMIZABLE_PARAMS)
        task_ids: Which eval tasks to use. None = all.
        generations: Number of GEPA generations (more = better but costlier)
        population_size: Candidates per generation
        model: LLM for GEPA's reflection/mutation (not the agent's model)
    """
    # Load current value as seed
    seed = load_param(param_name)
    if not seed:
        raise ValueError(f"Parameter {param_name} not found at {OPTIMIZABLE_PARAMS[param_name]}")

    evaluator = ConstructEvaluator(task_ids=task_ids, param_name=param_name)

    # Configure GEPA
    result = gepa.optimize(
        # The seed candidate — current skill/config content
        seed_candidate=seed,

        # The evaluator function — GEPA calls this for each candidate
        evaluate_fn=evaluator.evaluate,

        # GEPA config
        num_generations=generations,
        population_size=population_size,

        # The LLM that does reflection + mutation (reads traces, proposes fixes)
        reflection_lm=model,

        # Constraints on what GEPA can change
        # Keep the YAML frontmatter intact — only mutate the markdown body
        constraints=[
            "Preserve the YAML frontmatter block (--- ... ---) exactly as-is",
            "Keep the same overall structure and section headings",
            "Do not remove any existing capability — only refine instructions",
            "Changes should make the agent more decisive and produce more complete code",
            "Do not add instructions that conflict with the agent's core identity",
        ],

        # What GEPA should optimize for (guides reflection)
        objective=(
            "Improve the agent's ability to produce complete, working code on the first attempt. "
            "Reduce unnecessary tool calls and turns. Ensure all required sections/features are "
            "included. The agent should be decisive — write full files, not incremental stubs."
        ),
    )

    return result


def apply_result(param_name: str, result: gepa.OptimizationResult, backup: bool = True):
    """Apply the best GEPA result back to the actual skill/config file.

    Args:
        param_name: Which parameter was optimized
        result: The GEPA optimization result
        backup: Whether to save the original as .backup
    """
    path = OPTIMIZABLE_PARAMS[param_name]
    if backup and path.exists():
        backup_path = path.with_suffix(path.suffix + ".backup")
        backup_path.write_text(path.read_text())
        print(f"Backed up original to {backup_path}")

    path.write_text(result.best_candidate)
    print(f"Applied optimized {param_name} to {path}")
    print(f"Score improvement: {result.seed_score:.2f} → {result.best_score:.2f}")
