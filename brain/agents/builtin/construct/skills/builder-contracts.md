---
id: builder-contracts
name: Contract-First Development
description: Read real contracts before writing code — library APIs, framework conventions, schema shapes, routes, env vars, and data lifecycles. Prevents guessed-API bugs.
trigger: "contract,api contract,props,types,schema,route,endpoint,payload,preflight,stale api,guessing,regression,bug prevention"
category: construct
---

# Contract-First Development

Most bugs come from guessed contracts: invented function signatures, assumed payload shapes, wrong component props, or route patterns that don't match the router. Before touching code, make the contracts explicit.

## Contract Map

For any non-trivial change, identify what you're touching:

- **Library APIs** — props, events, methods of any component or library you call. Don't invent. Read the source or docs.
- **HTTP endpoints** — method, path, request body shape, response shape, auth header. Check the actual handler, not your mental model.
- **Database / ORM schema** — real column names, types, relations, nullable fields.
- **Environment variables** — names as they actually appear in `.env.sample` or config. Never invent a var name.
- **File system paths** — project root, output dirs, config file locations.
- **Framework conventions** — routing (file-based vs. config), SSR vs. client-only, middleware order.
- **Package manager** — lockfile determines the tool. Never switch.
- **Data lifecycle** — create, list, update, delete. Does delete cascade? Is list stale after mutation?

If a contract matters and you haven't read it this session, read it before writing code.

## Do Not Guess

- Do not invent component props, slot names, or event names. Read the source.
- Do not assume an HTTP response shape. Read the handler or schema.
- Do not assume `process.env.FOO` is available. Check `.env.sample` or the config loader.
- Do not assume a route path. Check the router config or file structure.
- Do not assume a library export exists. Check `package.json` → source → exports.

## Data Integrity

- Delete by querying and removing persisted children, not filtering local arrays.
- After mutation, update local state only after the persisted operation succeeds.
- Empty state (zero records, null response) must render gracefully in every view.
- List views must reflect mutations without requiring a full page reload unless that's intentional.

## Preflight Before Writing

```bash
grep -rn "TODO\|FIXME\|@ts-ignore" src
grep -rn "process\.env\." src         # find all env var references
```

Don't blindly act on results — read them and understand whether they're intentional.

## Done Means Contract Verified

Before reporting done, prove:

- Every library API used exists and the usage matches the real signature.
- Every HTTP call uses the correct method, path, and payload shape.
- Schema matches what the DB/ORM actually has.
- Empty, populated, mutation, and one failure path were exercised.
