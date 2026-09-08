---
id: builder-verify
name: Verification Ladder
description: Prove the change actually works — build, test, exercise, adversarial probes
trigger: "verify,validate,check,test,run,exercise,prove,typecheck,lint,build"
category: construct
---

# Verification Ladder

"Build succeeded" is not done. "Tests pass" is a step on the way. **Exercised behavior** is done.

## Baseline — Every Change

Pick the ones that apply. Don't run a tool the project doesn't have.

1. **Typecheck** — `tsc --noEmit`, `vue-tsc`, `mypy`, `go build`, etc. Runs only when types are in the project.
2. **Lint** — `eslint`, `ruff`, `golangci-lint`, `biome`. Same gate: only when in the project.
3. **Build** — whatever script produces the deployable artifact.
4. **Tests** — the project's test command.

If a step fails, fix the specific error and re-run **only** the failed step plus downstream. Don't re-run the whole ladder on every small edit.

If a check is blocked by a pre-existing unrelated failure, record the exact command and error, then run the narrowest relevant checks for your touched files. Do not claim the global gate passed.

## Behavior Verification (at least one)

Pick what fits the change:

- **Web page / app** — call `start_preview`, then `list_windows` to find the preview window label, then `screenshot_window(label)` to capture it. Confirm the page renders, content is visible, no blank screen or error overlay.
- **API / service** — `curl` the endpoint, check status + payload shape.
- **CLI / script** — run it, check stdout/exit code.
- **Library code** — write or run a unit test that exercises the new path.
- **Deploy** — preview URL + `screenshot_window` to confirm the page loads.

`screenshot_window` is the fastest visual proof. Use it. It returns a file path — embed it as `![alt](/abs/path.png)` to render inline. Never paste base64 data URIs into messages.

Prefer a quick real-exercise over a mental walkthrough. Five seconds of `curl | jq` beats five minutes of reasoning about whether the JSON shape is right.

## Adversarial Probes (required for non-trivial work)

Before reporting done, try at least one realistic failure path:

- **Empty input** — no data, does the UI or API degrade well?
- **Invalid input** — does validation fire?
- **Repeated action** — idempotent where it should be?
- **Boundary** — first record, last record, max length, unicode.
- **Offline / failure** — does the error path render?

One probe is fine. It's about proving the thing isn't made of glass.

## When Something Fails

1. Read the exact error. Don't guess.
2. Identify the file and line it names.
3. Fix the smallest relevant code.
4. Re-run only the failed step.

If the same error recurs on the same file after two attempts, stop and call `ask_user` with the specific error. Don't keep looping — the second guess is usually wrong the same way as the first.

## Reporting Done

State in one sentence:
- What you built or changed.
- Which verification steps passed (baseline + behavior + at least one adversarial probe).
- Any caveats.

Never claim done if a verification step was skipped. If you had to skip one (no network for a deploy preview, no browser for a UI check), say so explicitly.
