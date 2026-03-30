#!/usr/bin/env python3
"""
Run GEPA optimization on Construct Operator agent parameters.

Usage:
    # Optimize the Coder's frontend skill against all tasks
    python run_optimization.py --param coder_skill_frontend

    # Optimize just against the landing page task, 5 generations
    python run_optimization.py --param coder_skill_frontend --tasks landing_page --generations 5

    # Optimize the Coder's main config
    python run_optimization.py --param coder_config

    # Dry run — just evaluate current params without optimizing
    python run_optimization.py --param coder_skill_frontend --eval-only

    # Apply a previous optimization result
    python run_optimization.py --apply results/best_coder_skill_frontend.md --param coder_skill_frontend
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime
from pathlib import Path

from gepa_adapter import (
    OPTIMIZABLE_PARAMS,
    apply_result,
    load_param,
    optimize_param,
    ConstructEvaluator,
)


def main():
    parser = argparse.ArgumentParser(description="GEPA optimization for Construct Operator")
    parser.add_argument(
        "--param",
        required=True,
        choices=list(OPTIMIZABLE_PARAMS.keys()),
        help="Which parameter to optimize",
    )
    parser.add_argument("--tasks", nargs="*", help="Specific task IDs (default: all)")
    parser.add_argument("--generations", type=int, default=10, help="GEPA generations (default: 10)")
    parser.add_argument("--population", type=int, default=5, help="Population size (default: 5)")
    parser.add_argument("--model", default="claude-sonnet-4-6", help="Reflection LLM model")
    parser.add_argument("--eval-only", action="store_true", help="Just evaluate, don't optimize")
    parser.add_argument("--apply", help="Apply a saved result file")
    parser.add_argument("--output-dir", default="results", help="Where to save results")
    args = parser.parse_args()

    if args.apply:
        # Apply a saved best candidate
        content = Path(args.apply).read_text()

        class FakeResult:
            best_candidate = content
            seed_score = 0
            best_score = 0

        apply_result(args.param, FakeResult())
        return

    if args.eval_only:
        # Just run the eval harness with current params
        print(f"Evaluating current {args.param}...")
        evaluator = ConstructEvaluator(task_ids=args.tasks, param_name=args.param)
        current = load_param(args.param)
        score, asi = evaluator.evaluate(current)
        print(f"\nCurrent score: {score:.2f}")
        print(f"\n{asi}")
        return

    # Run GEPA optimization
    print(f"Optimizing: {args.param}")
    print(f"Tasks: {args.tasks or 'all'}")
    print(f"Generations: {args.generations}, Population: {args.population}")
    print(f"Reflection model: {args.model}")
    print(f"Parameter file: {OPTIMIZABLE_PARAMS[args.param]}")
    print()

    result = optimize_param(
        param_name=args.param,
        task_ids=args.tasks,
        generations=args.generations,
        population_size=args.population,
        model=args.model,
    )

    # Save results
    os.makedirs(args.output_dir, exist_ok=True)
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")

    # Save best candidate
    best_path = Path(args.output_dir) / f"best_{args.param}_{timestamp}.md"
    best_path.write_text(result.best_candidate)
    print(f"\nBest candidate saved to: {best_path}")

    # Save full optimization log
    log_path = Path(args.output_dir) / f"log_{args.param}_{timestamp}.json"
    log_data = {
        "param": args.param,
        "seed_score": result.seed_score,
        "best_score": result.best_score,
        "generations": args.generations,
        "population": args.population,
        "model": args.model,
        "timestamp": timestamp,
    }
    log_path.write_text(json.dumps(log_data, indent=2))

    print(f"Optimization log saved to: {log_path}")
    print(f"\nScore: {result.seed_score:.2f} → {result.best_score:.2f}")
    print(f"\nTo apply: python run_optimization.py --apply {best_path} --param {args.param}")


if __name__ == "__main__":
    main()
