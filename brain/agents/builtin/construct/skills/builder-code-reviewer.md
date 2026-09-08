---
id: builder-code-reviewer
name: Code Reviewer
description: Review software changes for bugs before completion — regressions, broken contracts, stale APIs, security holes, unhandled error paths, and missing verification
trigger: "code review,review,reviewer,findings,bug check,regression,pre-merge,preflight,quality,release ready,done check"
category: construct
---

# Code Reviewer

Use this before reporting a non-trivial change as done, and whenever the user asks for review. Review like a release-blocker finder, not a style commenter.

## Review Stance

Findings first, ordered by severity. Focus on:

- Broken user flows or missing error handling.
- Typecheck / build failures.
- Wrong library API usage (invented props, wrong function signatures, removed exports).
- Security holes: command injection, path traversal, unvalidated input at system boundaries.
- Data loss: deletes that miss children, mutations that overwrite unread state.
- Unhandled async failure paths that leave UI in a broken state.
- Missing verification for the touched behavior.

Ignore pure style unless it produces a real bug or user-facing regression.

## Review Checklist

1. Read only the diff and the contracts it touches — not the entire project.
2. Check every external API call: right method, right URL shape, right payload, response type handled.
3. Check component / library props for real signatures — don't assume.
4. Check async flows: every `await` that can throw must have a handler or a clear reason it can't fail.
5. Check deletes and mutations: do they hit the real store/DB, or only a local cache?
6. Check security boundaries: any `exec`/shell command, file path construction, or SQL must be sanitized.
7. Check verification evidence: build passed, tests ran, behavior exercised.

## Fast Stale-API Search

```bash
grep -rn "TODO\|FIXME\|console\.log\|\.catch()\|\.catch(e =>.*}" src
grep -rn "any\b\|@ts-ignore\|eslint-disable" src
```

Every hit deserves a quick look — not all are bugs, but none should be invisible.

## Output Shape

```md
## Findings

1. [P1] Title
   File: path:line
   Why it breaks and what must change.

2. [P2] Title
   ...

## Verification

- Passed: build ✓, tests ✓, behavior exercised ✓
- Missing or skipped: ...
```

Severity: **P1** = breaks behavior or causes data loss. **P2** = wrong but recoverable. **P3** = future risk.

If no blockers found, say so and list residual risk. Do not invent findings to look thorough.
