---
id: space-contracts
name: Contract-First Space Development
description: Prevent Space bugs by reading real contracts before coding — manifest, UI props/slots, SDK exports, Graph models, routes, actions, and data lifecycles.
trigger: "contract,api contract,props,slots,events,route,manifest,actions,preflight,stale api,guessing,regression,bug prevention"
category: construct
---

# Contract-First Space Development

Most Space bugs come from guessed contracts: wrong component props, stale SDK shapes, route mismatches, cached-only deletes, or model fields that don't match Graph. Before touching code, make the contracts explicit.

## Contract Map

For any non-trivial Space change, identify the touched contracts:

- Manifest: `space.manifest.json` pages, navigation, widgets, actions, `scopes`, `permissions`.
- Routes: files under `src/pages/` and generated page paths.
- UI: component props, events, and slots from `@construct-space/ui` 1.0 or the `space-ui` skill.
- SDK: actual exports from `@construct-space/sdk` 1.0 or the `space-sdk` skill.
- Graph: one model per file, `scopes`, access, relations, ACL, and CRUD behavior.
- Actions: `src/actions.ts` names, inputs, and return shapes.
- Data lifecycle: create, list, update, delete, empty state, and persisted children.

If a contract matters and you have not read it this turn, read it or load the relevant skill before writing code.

## Do Not Guess

- Do not invent UI props, slots, events, or component names. Check the skill or source.
- Do not use stale SDK patterns. Import from `@construct-space/sdk`; use `useAuthStore()` for auth state, `useToast()` for inline feedback, `useNotification()` for the host bell/inbox surface. `useApi`, `useOperator`, `useProjectStore`, `useTheme`, `usePermissions`, `useNotifications` (plural) are all removed in 1.0.
- Do not assume `space.manifest.json` route names; inspect pages and keep manifest synchronized.
- Do not hand-edit generated `src/entry.ts`; fix manifest/pages/actions and rebuild.
- Do not add tenant columns for Graph org scope; use `{ scopes: ['org'] }` (array, not singular).
- Do not confuse `useStorage()` (file/blob storage) with `useLocalStorage()` (browser KV).

## Data Integrity Rules

Persistent data must be correct from both list and detail flows:

- Delete parents by querying/removing persisted children, not just currently cached arrays.
- If a child can exist without opening the parent detail page, delete logic must fetch children by FK before deleting the parent.
- When using Graph relations, do not duplicate manual `<target>_id` fields with `relation.belongsTo(Target)`.
- For folder/tree data, recursive deletes must cover descendant folders and files.
- After mutation, update local state only after the persisted operation succeeds.

## Preflight Before Build

Run targeted checks before `space_check`:

```bash
rg -n "useData|useApi|useOperator|useProjectStore|useTheme|usePermissions|useNotifications\\b|@construct/sdk|#title|\\bcompany\\b|standalone|JSON\\.stringify|JSON\\.parse|scope:\\s*['\"]" .
rg -n "TODO|FIXME|console\\.log" src
```

The first search flags removed SDK imports, the legacy `@construct/sdk` alias, the old singular `scope:` manifest key, and stale workarounds (`JSON.stringify` around `field.json()`).

Interpret these, don't blindly delete them. Some matches are legitimate, but every match deserves a quick look.

## Done Means Contract Verified

Before reporting done, prove:

- Manifest routes match files.
- UI component APIs used are real.
- SDK imports are real.
- Graph schema pushed or migration status is known when models changed.
- Empty, populated, mutation, and one failure path were exercised.
