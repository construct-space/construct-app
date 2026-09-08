---
id: space-scope
name: Space Scope & Tenancy
description: Pick the right manifest scopes (app/org) — governs where the Space appears and who shares its data.
trigger: "scope,scopes,tenant,tenancy,multi-tenant,shared,share with,team,company,org-wide,per-user,who sees,access,visibility,permissions,permission catalog"
category: construct
---

# Space Scope & Tenancy

Every Space declares `scopes` in its `space.manifest.json` (array, not singular). Scopes decide **where the Space appears in the UI** and — just as important — **who shares its data**. Pick wrong and the data model is wrong.

> **Not the same as publish visibility.** `scopes` is a UI/data property baked into the manifest. `construct publish --private` (catalog visibility: public vs org-only) is a separate publishing-time choice that controls who can install the space from the marketplace. A `scopes: ['app']` space can be published `--private`; a `scopes: ['org']` space can be published publicly. See `skill:space-cli` for the publish flag.

## The Two Scopes (1.0)

`scopes: Array<'app' | 'org'>`. **There is no more `'project'` scope** — it was removed in 1.0 along with project-context injection from the SDK.

| Scope | Where it appears | Data tenancy | Typical use |
|---|---|---|---|
| `app` | App-level sidebar | **1:1 per user** — each user has their own data | Personal tools: notes, daily log, clipboard, dev settings |
| `org` | Requires an active org | **multi-tenant / shared across the org** — every org member sees the same data | Shared resources: org-wide HR, CRM, calendar, org insights |

A space can declare both: `scopes: ['app', 'org']` — same code, two surfaces, two data buckets. The runtime picks the bucket based on the active context when the space is opened.

## Permissions catalog

A space can declare its RBAC catalog up front so org admins can grant/revoke roles. Optional but recommended for `org` spaces. The modern object form maps actions to permission ids and declares the catalog visible at install time:

```json
"permissions": {
  "actions": {
    "createCustomer": "crm:write",
    "summarizeAccount": "crm:brain"
  },
  "catalog": [
    { "id": "crm:read",  "label": "View customers", "group": "CRM" },
    { "id": "crm:write", "label": "Edit customers", "group": "CRM" },
    { "id": "crm:brain", "label": "Use AI to summarise accounts", "group": "CRM" }
  ]
}
```

Permission ids are `<space-id>:<key>`. The legacy flat
`SpacePermission[]` shape (`{ key, label, description }[]`) is still
accepted for back-compat but new spaces should use the structured form
above. Brain access for a space's actions uses `<space-id>:brain` by
convention — see `skill:space-sdk` for the `useBrain()` pattern.

The space then checks runtime grants via `useAuthorization()` from the SDK.

## Matching scope to graph data scope

If your Space uses the Graph (see `skill:space-graph`), the graph model `scopes` **must match** the manifest `scopes`. They share the same two values 1:1:

- manifest `['app']` → `defineModel({...}, { scopes: ['app'] })`
- manifest `['org']` → `defineModel({...}, { scopes: ['org'] })`
- manifest `['app','org']` → `defineModel({...}, { scopes: ['app','org'] })`

Mismatched scopes mean either **data you can't see** (graph scoped too narrow) or **data leaking across tenants** (graph scoped too wide).

## Org Scope Multitenancy

For `scopes: ['org']`, Graph tenancy is automatic and server-side. Define models with `{ scopes: ['org'] }`; do **not** add `org_id`, `company_id`, or tenant columns for isolation, and do **not** pass `companyId` to `useGraph()`. The active org from the authenticated session selects the tenant bucket.

Access rules are separate from tenancy. If every logged-in org member should share the same records, avoid `'owner'` for `read`/`update` because that makes records visible or editable only by the creator. Use `'authenticated'` for broadly shared org tables, `'member'` only when you intentionally need the stricter membership check, and `'admin'` for admin-only writes.

```ts
export const Employee = defineModel('employee', {
  name: field.string().required(),
  email: field.string().email(),
  role: field.string(),
}, {
  scopes: ['org'],
  access: {
    read: 'authenticated',
    create: 'authenticated',
    update: 'authenticated',
    delete: 'admin',
  }
})
```

## Signal words in the user's ask

Listen for these when classifying:

| User says… | Likely scope |
|---|---|
| "just for me", "my notes", "personal" | `['app']` |
| "the whole team", "shared with my org", "company-wide", "everyone at work" | `['org']` |
| "works both as a personal tool and for my team" | `['app', 'org']` |

## **If the user didn't say — ASK**

Most users don't know Construct's scope model. **Do not guess.** If the ask is even slightly ambiguous, call `ask_user` with a friendly explanation. Suggested wording:

> Before I scaffold, I need to know who should share this Space's data. Construct has two scopes:
>
> - **app** — just you. Opens from the main sidebar. Your personal tool.
> - **org** — shared by everyone in your organization (multi-tenant).
>
> A space can also do both. Which fits what you're building?

Adapt the framing if the user's ask already rules out one (e.g. "I want this for my whole team" → only `['org']` is realistic, confirm it rather than listing both).

## Hard rules

1. **Never scaffold without known scopes.** If unclear, `ask_user` first.
2. **`scopes` is an array, not a string.** Always `['app']`, never `'app'`.
3. **Match manifest scopes to graph scopes.** Validate before `space_build`.
4. **Explain tenancy on org scope.** On `org`, surface to the user in your plan: "Every member of the org will see and edit the same data." That's the contract — let them confirm.
5. **Only `'app' | 'org'`.** Legacy values (`'project'`, `'company'`, `'both'`, `'standalone'`, `'any'`) are no longer accepted — validator, type, and runtime will reject them. If you see them in an older space, rewrite: `'company'` → `'org'`, `'standalone'` → `'app'`, `'project'` and `'any'` → pick `['app']` or `['org']` based on actual data ownership.
