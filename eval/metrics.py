"""
Evaluation metrics for Construct agent runs.

Each metric takes a workspace path + RunResult trace and returns a score [0, 1]
plus diagnostic text (the ASI that GEPA uses for reflection).
"""

from __future__ import annotations

import os
import re
from dataclasses import dataclass


@dataclass
class MetricResult:
    """Result of a single metric evaluation."""

    score: float  # 0.0 = fail, 1.0 = pass
    diagnosis: str  # Human-readable explanation (becomes GEPA's ASI)


def file_exists(workspace: str, trace: dict, *, path: str) -> MetricResult:
    """Check if a file was created."""
    full = os.path.join(workspace, path)
    if os.path.isfile(full):
        lines = len(open(full).readlines())
        return MetricResult(1.0, f"{path} exists ({lines} lines)")
    return MetricResult(0.0, f"{path} NOT FOUND. Agent failed to create this file. "
                        f"Tool calls made: {_tool_summary(trace)}")


def file_min_lines(workspace: str, trace: dict, *, path: str, min_lines: int) -> MetricResult:
    """Check file is substantial, not a stub."""
    full = os.path.join(workspace, path)
    if not os.path.isfile(full):
        return MetricResult(0.0, f"{path} does not exist")
    lines = len(open(full).readlines())
    if lines >= min_lines:
        return MetricResult(1.0, f"{path} has {lines} lines (min {min_lines})")
    ratio = lines / min_lines
    return MetricResult(
        ratio,
        f"{path} only has {lines} lines, expected at least {min_lines}. "
        f"Agent likely produced a stub or skeleton instead of complete code."
    )


def content_contains_all(workspace: str, trace: dict, *, path: str, patterns: list[str]) -> MetricResult:
    """Check file contains ALL required patterns (case-insensitive)."""
    full = os.path.join(workspace, path)
    if not os.path.isfile(full):
        return MetricResult(0.0, f"{path} does not exist")
    content = open(full).read().lower()
    missing = [p for p in patterns if p.lower() not in content]
    if not missing:
        return MetricResult(1.0, f"All {len(patterns)} patterns found in {path}")
    found = [p for p in patterns if p.lower() in content]
    score = len(found) / len(patterns)
    return MetricResult(
        score,
        f"Missing from {path}: {missing}. Found: {found}. "
        f"The agent's system prompt or skill should emphasize including these sections."
    )


def content_contains_any(workspace: str, trace: dict, *, path: str, patterns: list[str]) -> MetricResult:
    """Check file contains AT LEAST ONE of the patterns."""
    full = os.path.join(workspace, path)
    if not os.path.isfile(full):
        return MetricResult(0.0, f"{path} does not exist")
    content = open(full).read().lower()
    found = [p for p in patterns if p.lower() in content]
    if found:
        return MetricResult(1.0, f"Found patterns in {path}: {found}")
    return MetricResult(0.0, f"None of {patterns} found in {path}")


def content_matches_regex(workspace: str, trace: dict, *, path: str, regex: str) -> MetricResult:
    """Check file content matches a regex pattern."""
    full = os.path.join(workspace, path)
    if not os.path.isfile(full):
        return MetricResult(0.0, f"{path} does not exist")
    content = open(full).read()
    if re.search(regex, content, re.MULTILINE | re.IGNORECASE):
        return MetricResult(1.0, f"Pattern /{regex}/ matched in {path}")
    return MetricResult(0.0, f"Pattern /{regex}/ NOT matched in {path}")


def token_budget(workspace: str, trace: dict, *, max_input: int, max_output: int) -> MetricResult:
    """Score based on token efficiency. Under budget = 1.0, over = proportional penalty."""
    usage = trace.get("usage", {})
    inp = usage.get("input_tokens", 0)
    out = usage.get("output_tokens", 0)

    input_ratio = min(inp / max_input, 2.0) if max_input else 0
    output_ratio = min(out / max_output, 2.0) if max_output else 0

    # Score: 1.0 if under budget, degrades linearly to 0.0 at 2x budget
    score = max(0.0, 1.0 - max(input_ratio - 1.0, output_ratio - 1.0, 0.0))

    diagnosis = (
        f"Tokens — input: {inp}/{max_input} ({input_ratio:.1%}), "
        f"output: {out}/{max_output} ({output_ratio:.1%}). "
    )
    if score < 1.0:
        diagnosis += "Agent is over token budget. Prompt may be causing verbose reasoning or redundant tool calls."
    return MetricResult(score, diagnosis)


def max_turns(workspace: str, trace: dict, *, max_turns: int) -> MetricResult:
    """Score based on turn count. Fewer turns = more decisive agent."""
    actual = trace.get("turn_count", 0)
    if actual <= max_turns:
        return MetricResult(1.0, f"Completed in {actual} turns (max {max_turns})")
    overshoot = (actual - max_turns) / max_turns
    score = max(0.0, 1.0 - overshoot)
    return MetricResult(
        score,
        f"Took {actual} turns (max {max_turns}). "
        f"Agent may be indecisive, reading files it already read, or making small incremental edits "
        f"instead of writing complete files. The system prompt should emphasize decisive action."
    )


def build_succeeds(workspace: str, trace: dict, *, command: str) -> MetricResult:
    """Run a build command and check it succeeds."""
    import subprocess
    result = subprocess.run(
        command, shell=True, cwd=workspace,
        capture_output=True, text=True, timeout=60
    )
    if result.returncode == 0:
        return MetricResult(1.0, f"Build succeeded: {command}")
    stderr = result.stderr[-500:] if len(result.stderr) > 500 else result.stderr
    return MetricResult(
        0.0,
        f"Build FAILED: {command}\n"
        f"Exit code: {result.returncode}\n"
        f"stderr: {stderr}\n"
        f"The agent produced code that doesn't compile/build. "
        f"System prompt should emphasize verifying code before finishing."
    )


# ─── Helpers ───


def _tool_summary(trace: dict) -> str:
    """Summarize tool calls from trace for diagnostic output."""
    turns = trace.get("turns", [])
    calls = []
    for t in turns:
        for tc in t.get("tool_calls", []):
            name = tc.get("name", "?")
            is_error = tc.get("is_error", False)
            calls.append(f"{name}{'(ERR)' if is_error else ''}")
    return " → ".join(calls) if calls else "(no tool calls)"


# Registry of all metric functions
METRICS = {
    "file_exists": file_exists,
    "file_min_lines": file_min_lines,
    "content_contains_all": content_contains_all,
    "content_contains_any": content_contains_any,
    "content_matches_regex": content_matches_regex,
    "token_budget": token_budget,
    "max_turns": max_turns,
    "build_succeeds": build_succeeds,
}
