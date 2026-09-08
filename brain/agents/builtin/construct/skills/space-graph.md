---
id: space-graph
name: Graph Data Modeling
description: Persistent structured data for Spaces via @construct-space/graph — models, fields, relations, access control, queries
trigger: "graph,data model,defineModel,useGraph,relation,field,migration,persistence,scopes,acl,useAccess,bundle_id,extractManifest"
category: construct
---

# Graph — Persistent Data for Spaces

Use Graph when a Space needs real app data: records with identity, relations, filters, queries, CRUD, or cross-session persistence. Do not use ad-hoc JSON files or oversized local storage for that.

## Current baseline

Assume the current Graph stack unless local package checks prove otherwise:

- `@construct-space/graph >= 1.0.0`
- `@construct-space/cli >= 1.0.0`
- Graph service: `https://graph.construct.space`

With this baseline, string/boolean defaults, relation schema pushes, and JSON field round trips are supported. Do not add old workarounds such as hand-setting string defaults in composables, avoiding `relation.belongsTo()` because of push ordering, or manually `JSON.stringify()`/`JSON.parse()`-ing `field.json()` values.

## Always use the CLI for schema operations

All model/schema operations go through the `construct graph` CLI. Inside Space Developer, use the `space_graph_*` tools when available; they shell out to the same CLI in the right space directory. Do **not** hand-write migration files, do **not** POST to the graph API directly, and do **not** hand-edit generated types. The CLI is the single path that keeps local models, the server schema, and generated types in sync.

```
construct graph init       # scaffold src/models/ + wire deps
construct graph g <Model> <fields...>   # generate a model file
construct graph push       # register models with the service
construct graph fork <new-space-id>     # fork sticky schema ownership
construct graph migrate    # compare local vs server schema
construct graph migrate --apply   # apply (destructive changes allowed)
```

Auth is automatic: the CLI mirrors the desktop app's active profile
when no separate CLI login exists, so `construct graph push` works as
soon as the user is signed into Construct. If push *still* fails with
an auth error, the user is signed out — tell them to sign in via the
desktop app (or run `construct login` for a CLI-only token); don't try
to work around it.

Schema ownership is sticky to the first profile that pushed it. If a handoff fails with an ownership error, run `construct graph fork <new-space-id>` and then `construct graph push`, or push from the original owner profile. Do not ask the user to edit database rows.

## Decision Matrix

| Need | Use |
|---|---|
| Records with IDs, relations, queries | **Graph** |
| User preferences, lightweight settings | `useLocalStorage` (browser localStorage KV) |
| User-uploaded files / blob artifacts | `useStorage` (per-space file storage) |
| UI-only transient state | `ref`/`reactive` |

## Initialize

Run **once** per Space that needs Graph:

```bash
construct graph init
```

This creates `src/models/` and wires the dependency.

Keep one `defineModel()` per file under `src/models/`. The CLI parser reads model files one at a time and extracts one model from each file; putting multiple models in a single file can silently drop or mangle models during `push`. Use `src/models/index.ts` only as a re-export barrel.

## Define a Model

```ts
// src/models/Note.ts
import { defineModel, field, relation, access } from '@construct-space/graph'

export const Note = defineModel('note', {
  content: field.string().required(),
  color: field.string().default('yellow'),
  tags: field.json(),
  position_x: field.int(),
  position_y: field.int(),
  is_pinned: field.boolean().default(false),
}, {
  scopes: ['app'],   // 1.0: array of 'app' | 'org' (was singular `scope`)
  access: {
    read: 'owner',
    create: 'authenticated',
    update: 'owner',
    delete: 'owner',
  }
})
```

Access levels are bare string literals in 1.0: `'public' | 'authenticated' | 'owner' | 'member' | 'admin' | 'none'`. The old `access.owner()` helper functions are gone.

## Per-row ACL — `useAccess`

Coarse `access:` rules gate the whole table. For per-row ABAC (e.g. "this document is shared with these three users"), attach an `acl: AclBinding` to the row and check it from the client:

```ts
import { useAccess } from '@construct-space/sdk'

const can = useAccess(Document, row)
if (can.update) { /* show edit button */ }
```

Personal-context rows auto-permit (the owner is always allowed). Org-context rows consult the binding.

## Client API — `useGraph(Model)` returns the client directly

**Important:** `useGraph(Model)` returns a `GraphClient<T>` ready to call. There is no `useData` and no `graph.query(Model).find()` wrapper. Do not wrap it in `.query(Model)`.

```ts
import { useGraph, type DataRecord } from '@construct-space/graph'
import { Note } from '../models/Note'

interface NoteRecord extends DataRecord {
  content: string
  color: string
  is_pinned: boolean
}

const notes = useGraph<NoteRecord>(Note)

const all    = await notes.find()                      // T[]
const one    = await notes.findOne(id)                 // T | null
const made   = await notes.create({ content: 'hi' })   // T
const upd    = await notes.update(id, { color: 'red' })
const ok     = await notes.remove(id)                  // boolean
const n      = await notes.count()                     // number
```

## Composable wrapper (optional, keeps components lean)

Wrapping per-model in a composable avoids repeating the `useGraph` call in every component. Cache the client so you don't rebuild it each call:

```ts
// src/composables/useNotes.ts
import { useGraph, type DataRecord } from '@construct-space/graph'
import { Note } from '../models/Note'

export interface NoteRecord extends DataRecord {
  content: string
  color: string
  is_pinned: boolean
}

let _client: ReturnType<typeof useGraph<NoteRecord>> | null = null
function client() {
  if (!_client) _client = useGraph<NoteRecord>(Note)
  return _client
}

export function useNotes() {
  return {
    list:   ()                             => client().find(),
    get:    (id: string)                   => client().findOne(id),
    create: (data: Partial<NoteRecord>)    => client().create(data),
    update: (id: string, data: Partial<NoteRecord>) => client().update(id, data),
    remove: (id: string)                   => client().remove(id),
    count:  ()                             => client().count(),
  }
}
```

## Field Types

`field.string()`, `field.int()`, `field.number()`, `field.boolean()`, `field.date()`, `field.json()`, `field.enum(['a', 'b'])`.

`field.json()` accepts normal JS values through `useGraph()`: arrays, objects, strings, numbers, booleans, or null. The SDK serializes writes and parses reads at the boundary.

## Modifiers

`.required()`, `.unique()`, `.index()`, `.default(val)`, `.email()`, `.url()`, `.min(n)`, `.max(n)`.

Chain with `:` in the CLI shorthand: `email:string:required:unique:email`.

Defaults are safe for strings, booleans, numbers, ints, and enums:

```ts
currency: field.string().default('USD'),
active: field.boolean().default(true),
attempts: field.int().default(0),
status: field.enum(['draft', 'sent']).default('draft'),
```

## Relations

```ts
department: relation.belongsTo(Department, { onDelete: 'set_null' }),
posts: relation.hasMany(Post),
```

`onDelete`: `'cascade' | 'set_null' | 'restrict'`.

Relation rules:

- Define related models in separate files, one model per file.
- Use `relation.belongsTo(Target)` by itself. Do not also add a manual `target_id: field.string()` column for the same relation, because Graph creates the `<relation>_id` foreign-key column.
- For writes, pass the generated FK name in data when attaching a parent, e.g. `await tasks.create({ title: 'Ship', project_id: project.id })`.
- Use `field.string()` foreign-key columns only when you intentionally want a manual link with no Graph relation or automatic `include` loading.

## Access Levels

`'public' | 'authenticated' | 'owner' | 'member' | 'admin' | 'none'`.

Scoping (1.0): `scopes: Array<'app' | 'org'>`. **Renamed from singular `scope` and dropped `'project'`** — there are now exactly two values, and a model may opt into both. Matches the host manifest vocabulary 1:1.

- `scopes: ['app']` — per-user (each user has their own data)
- `scopes: ['org']` — shared across the active org (multi-tenant; backend isolates by `X-Auth-Org-ID`)
- `scopes: ['app', 'org']` — same model serves both contexts; the current request context picks the bucket

For org-scoped multitenant data, put `scopes: ['org']` on the model and let Graph isolate by the authenticated active org. Do not add `org_id`/`company_id` tenant columns for security, and do not pass `companyId` to `useGraph()`; the backend resolves org identity server-side. Access rules still matter: `'owner'` means "creator only" inside the org, so use `'authenticated'` for broadly shared org records, `'member'` only for stricter membership checks, and `'admin'` for admin-only writes.

## Cross-space imports

Spaces under the same publisher can share models. Declare a `bundle_id` and import siblings:

```ts
import { extractManifest } from '@construct-space/graph'

export const manifest = extractManifest({
  bundle_id: 'acme-suite',
  imports: [{ from: 'space-acme-crm', models: ['Contact', 'Account'] }],
})
```

Same publisher only; cross-publisher sharing is not supported.

## Auto Fields (every model)

- `id` — UUID, auto-assigned
- `created_at`, `updated_at` — ISO timestamps
- `created_by` — owning user

## CLI Shorthand

```bash
construct graph g Note content:string:required color:string is_pinned:boolean
construct graph g Employee name:string:required email:string:required:unique:email department:belongsTo:Department
```

## Push + Migrate

After defining models:

```bash
construct graph push       # register models with the service
construct graph migrate    # compare local vs server schema
construct graph migrate --apply   # apply destructive changes (always explain first)
```

## Query API

`find(opts?)`, `findOne(id)`, `create(input)`, `update(id, input)`, `remove(id)`, `count(opts?)`, `query(gql)`, `mutate(gql)`.

`FindOptions`:
```ts
{ where, orderBy, limit, offset, include }
```

Filters:
```ts
{ content: { $like: '%todo%' }, created_at: { $gte: '2026-01-01' }, color: { $in: ['red', 'blue'] } }
```

Operators: `$gt`, `$gte`, `$lt`, `$lte`, `$in`, `$ne`, `$like`, `$null`.

JSON field example:

```ts
await notes.create({ content: 'Plan', tags: ['urgent', 'client'] })

const row = await notes.findOne(id)
row?.tags // ['urgent', 'client'], not a JSON string
```

## Verification

Always exercise:
- Empty state (no records)
- Populated state (at least one record)
- Create → update → delete round trip
- Relation load with `include`

If any of these fail, the Graph integration is not done.
