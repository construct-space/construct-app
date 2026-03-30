"""
Construct Eval Harness — runs agent tasks against Operator and evaluates results.

This is the bridge between GEPA and Operator. It:
1. Scaffolds a temporary workspace with task files
2. Sends the task to Operator via TCP (same protocol the frontend uses)
3. Captures the full RunResult (turns, tool calls, errors, usage)
4. Evaluates metrics and returns scores + diagnostic traces (ASI for GEPA)
"""

from __future__ import annotations

import json
import os
import shutil
import socket
import tempfile
import uuid
from dataclasses import dataclass, field
from pathlib import Path

import yaml

from metrics import METRICS, MetricResult


# ─── Config ───

OPERATOR_HOST = os.environ.get("OPERATOR_HOST", "localhost")
OPERATOR_PORT = int(os.environ.get("OPERATOR_PORT", "60100"))
SKILLS_DIR = Path(__file__).parent.parent / "frontend" / "spaces"
TASKS_DIR = Path(__file__).parent / "tasks"


@dataclass
class EvalTask:
    """A reproducible evaluation task."""

    id: str
    name: str
    agent: str
    category: str
    prompt: str
    scaffold: dict[str, str]  # relative path → content
    metrics: list[dict]

    @classmethod
    def load(cls, path: str | Path) -> "EvalTask":
        with open(path) as f:
            data = yaml.safe_load(f)
        return cls(
            id=data["id"],
            name=data["name"],
            agent=data["agent"],
            category=data.get("category", "general"),
            prompt=data["prompt"],
            scaffold=data.get("scaffold", {}),
            metrics=data.get("metrics", []),
        )


@dataclass
class EvalResult:
    """Full result of running one eval task."""

    task_id: str
    total_score: float
    metric_scores: dict[str, float]
    metric_diagnoses: dict[str, str]  # The ASI — diagnostic text per metric
    trace: dict  # Raw RunResult from Operator
    workspace: str

    def asi_text(self) -> str:
        """Format all diagnoses into a single ASI string for GEPA reflection."""
        lines = [f"## Eval: {self.task_id} — Score: {self.total_score:.2f}\n"]
        for mid, diag in self.metric_diagnoses.items():
            score = self.metric_scores.get(mid, 0.0)
            status = "PASS" if score >= 1.0 else "PARTIAL" if score > 0 else "FAIL"
            lines.append(f"### [{status}] {mid} ({score:.2f})")
            lines.append(diag)
            lines.append("")
        # Append tool call trace summary
        lines.append("### Execution Trace")
        lines.append(_format_trace(self.trace))
        return "\n".join(lines)


# ─── Operator Communication ───


def _send_to_operator(request: dict) -> dict:
    """Send a request to Operator via TCP and read the full response.

    Operator uses newline-delimited JSON over TCP. We send the request,
    then read streamed events until we get a session.end or the connection closes.
    """
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.settimeout(300)  # 5 min timeout for agent runs
    sock.connect((OPERATOR_HOST, OPERATOR_PORT))

    payload = json.dumps(request) + "\n"
    sock.sendall(payload.encode())

    # Read streamed events
    buffer = ""
    events = []
    final_result = {}

    try:
        while True:
            chunk = sock.recv(8192).decode()
            if not chunk:
                break
            buffer += chunk
            while "\n" in buffer:
                line, buffer = buffer.split("\n", 1)
                line = line.strip()
                if not line:
                    continue
                try:
                    event = json.loads(line)
                    events.append(event)
                    if event.get("type") == "session.end":
                        final_result = event.get("data", {})
                    elif event.get("type") == "result":
                        final_result = event.get("data", {})
                except json.JSONDecodeError:
                    continue
    except socket.timeout:
        pass
    finally:
        sock.close()

    # Build trace from events
    trace = _build_trace(events, final_result)
    return trace


def _build_trace(events: list[dict], result: dict) -> dict:
    """Build a structured trace from stream events."""
    turns = []
    current_turn_tools = []
    usage = {"input_tokens": 0, "output_tokens": 0}
    turn_count = 0

    for ev in events:
        t = ev.get("type", "")
        d = ev.get("data", {})

        if t == "turn.start":
            turn_count = d.get("turn", turn_count) + 1

        elif t == "tool.result":
            current_turn_tools.append({
                "name": d.get("tool", ""),
                "input": d.get("input", ""),
                "content": d.get("content", ""),
                "is_error": d.get("is_error", False),
            })

        elif t == "turn.end":
            turns.append({"tool_calls": current_turn_tools})
            current_turn_tools = []

        elif t == "token.usage":
            usage["input_tokens"] = d.get("total_input", usage["input_tokens"])
            usage["output_tokens"] = d.get("total_output", usage["output_tokens"])

    return {
        "turns": turns,
        "turn_count": turn_count,
        "usage": usage,
        "content": result.get("content", ""),
        "stop_reason": result.get("stop_reason", ""),
        "events": events,
    }


# ─── Workspace Management ───


def _scaffold_workspace(task: EvalTask) -> str:
    """Create a temp workspace with the task's scaffold files."""
    workspace = tempfile.mkdtemp(prefix=f"construct-eval-{task.id}-")
    for rel_path, content in task.scaffold.items():
        full_path = os.path.join(workspace, rel_path)
        os.makedirs(os.path.dirname(full_path), exist_ok=True)
        with open(full_path, "w") as f:
            f.write(content)
    return workspace


# ─── Core Eval Logic ───


def run_eval(task: EvalTask, skill_overrides: dict[str, str] | None = None) -> EvalResult:
    """Run a single eval task against Operator.

    Args:
        task: The eval task definition
        skill_overrides: Optional dict of {skill_name: new_content} to test
                        GEPA-mutated skill variants. These get injected into
                        the request context so Operator uses them instead of
                        the default skill files.
    """
    workspace = _scaffold_workspace(task)

    # Build the Operator request
    request = {
        "type": "dispatch",
        "data": {
            "agent_id": task.agent,
            "task": task.prompt,
            "project": {
                "name": f"eval-{task.id}",
                "type": "eval",
                "rootPath": workspace,
                "framework": "",
            },
            "session_id": str(uuid.uuid4()),
        },
    }

    # Inject skill overrides as request context
    if skill_overrides:
        request["data"]["context"] = {
            "skill_overrides": skill_overrides,
        }

    # Run the agent
    trace = _send_to_operator(request)

    # Evaluate metrics
    metric_scores = {}
    metric_diagnoses = {}
    total = 0.0
    total_weight = 0.0

    for m in task.metrics:
        mid = m["id"]
        fn = METRICS.get(m["check"])
        if not fn:
            metric_scores[mid] = 0.0
            metric_diagnoses[mid] = f"Unknown metric function: {m['check']}"
            continue

        result: MetricResult = fn(workspace, trace, **m.get("args", {}))
        metric_scores[mid] = result.score
        metric_diagnoses[mid] = result.diagnosis
        weight = m.get("weight", 1.0)
        total += result.score * weight
        total_weight += weight

    total_score = total / total_weight if total_weight > 0 else 0.0

    return EvalResult(
        task_id=task.id,
        total_score=total_score,
        metric_scores=metric_scores,
        metric_diagnoses=metric_diagnoses,
        trace=trace,
        workspace=workspace,
    )


def run_eval_suite(
    task_dir: str | Path = TASKS_DIR,
    skill_overrides: dict[str, str] | None = None,
) -> list[EvalResult]:
    """Run all eval tasks in a directory."""
    task_dir = Path(task_dir)
    results = []
    for task_file in sorted(task_dir.glob("*.yaml")):
        task = EvalTask.load(task_file)
        print(f"Running eval: {task.name}...")
        result = run_eval(task, skill_overrides)
        print(f"  Score: {result.total_score:.2f}")
        for mid, score in result.metric_scores.items():
            status = "PASS" if score >= 1.0 else "PARTIAL" if score > 0 else "FAIL"
            print(f"  [{status}] {mid}: {score:.2f}")
        results.append(result)
    return results


# ─── Helpers ───


def _format_trace(trace: dict) -> str:
    """Format trace into readable summary for ASI."""
    lines = []
    for i, turn in enumerate(trace.get("turns", [])):
        tools = turn.get("tool_calls", [])
        if tools:
            names = [f"{tc['name']}{'(ERR)' if tc.get('is_error') else ''}" for tc in tools]
            lines.append(f"Turn {i}: {' → '.join(names)}")
            # Include error details — this is the most valuable ASI
            for tc in tools:
                if tc.get("is_error") and tc.get("content"):
                    error_text = tc["content"][:300]
                    lines.append(f"  ERROR in {tc['name']}: {error_text}")
    usage = trace.get("usage", {})
    lines.append(f"Total: {trace.get('turn_count', 0)} turns, "
                 f"{usage.get('input_tokens', 0)} in / {usage.get('output_tokens', 0)} out tokens")
    lines.append(f"Stop reason: {trace.get('stop_reason', '?')}")
    return "\n".join(lines)


# ─── CLI ───


def main():
    import argparse

    parser = argparse.ArgumentParser(description="Run Construct eval harness")
    parser.add_argument("--task", help="Run a specific task by ID")
    parser.add_argument("--task-dir", default=str(TASKS_DIR), help="Directory with task YAML files")
    parser.add_argument("--show-asi", action="store_true", help="Print full ASI diagnostic text")
    args = parser.parse_args()

    if args.task:
        task_file = Path(args.task_dir) / f"{args.task}.yaml"
        task = EvalTask.load(task_file)
        result = run_eval(task)
        if args.show_asi:
            print("\n" + result.asi_text())
    else:
        results = run_eval_suite(args.task_dir)
        avg = sum(r.total_score for r in results) / len(results) if results else 0
        print(f"\nOverall: {avg:.2f} across {len(results)} tasks")
        if args.show_asi:
            for r in results:
                print("\n" + r.asi_text())


if __name__ == "__main__":
    main()
