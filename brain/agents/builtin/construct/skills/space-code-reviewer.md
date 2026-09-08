---
id: space-code-reviewer
name: Space Code Reviewer
description: Review Construct Spaces for bugs before completion — regressions, broken contracts, stale APIs, data loss, missing verification, and Graph lifecycle issues.
trigger: "code review,review,reviewer,findings,bug check,regression,pre-merge,preflight,quality,release ready,done check"
category: construct
---

# Space Code Reviewer

Use this before saying a Space is done, and whenever the user asks for review. Review like a release blocker finder, not a style commenter.

## Review Stance

Findings first, ordered by severity. Focus on:

- Broken user flows.
- Typecheck/build failures.
- Manifest/page/action route mismatches.
- Wrong UI/SDK/Graph API usage.
- Data loss, orphaned records, cached-only deletes.
- Scope or tenancy leaks.
- Missing verification for the touched behavior.

Ignore pure style unless it causes a real bug or user-facing regression.

## Review Checklist

1. Read the diff and the touched contracts, not the whole project.
2. Check `space.manifest.json` against `src/pages/`, widgets, and actions.
3. Check Vue files for real `@construct-space/ui` 1.0 props/events/slots. Flag references to removed components (`Sidebar3D`, `Toolbar3D`, `HeaderLayout`, `DashboardPanel`) and removed UI composables (`useTheme`, `useClipboard`, `useFormValidation`, etc.).
4. Check SDK imports against `@construct-space/sdk` 1.0. Removed: `useApi`, `useOperator`, `useProjectStore`, `useProjectContext`, `usePermissions`, `useNotifications` (plural), `useTheme`/`useAppTheme`, `useTauriContext`, `useAssistant`, `useSpeechToText`, `useTextToSpeech`. Storage: `useStorage` is now file/blob; KV is `useLocalStorage`.
5. If Graph changed, check model `scopes` (plural array)/access, relation FK use, ACL bindings, and full CRUD lifecycle.
6. Check deletes for persisted children, not just reactive cache filtering.
7. Check async flows for unhandled loading/error states and post-failure state mutation.
8. Check verification evidence: `space_validate`, `space_check`, `space_build`, runtime/snapshot/action probe.

## Fast Stale-API Search

Use targeted search when available:

```bash
rg -n "useData|useApi|useOperator|useProjectStore|useTheme|usePermissions|useNotifications\\b|@construct/sdk|Sidebar3D|Toolbar3D|HeaderLayout|DashboardPanel|#title|\\bcompany\\b|standalone|JSON\\.stringify|JSON\\.parse|scope:\\s*['\"]" .
rg -n "delete[A-Z]|remove[A-Z]|parent_id|folder_id|_id" src
```

The second search is for data-lifecycle review: any delete or FK path should make you ask whether persisted children are handled.

## Output Shape

If reviewing for the user:

```md
## Findings

1. [P1] Title
   File: path:line
   Why it breaks, and what must change.

## Verification

- Passed: ...
- Missing or skipped: ...
```

If no blockers are found, say so directly and list residual risk. Do not invent findings to look useful.
