# Construct as an AI Provider + Credits

**Date:** 2026-05-11
**Status:** Plan
**Owners:** flakerimi

## Goal

Give non-developer users free AI in marketplace spaces without exposing
provider details, abuse vectors, or per-token complexity. Construct
becomes a first-class provider in the catalog; usage is metered in
**credits**, not tokens.

- 100 free credits per user per day, hard reset at UTC midnight, no
  rollover.
- Paid credit top-ups never expire (Polar plan, phase 2).
- One prompt = one credit, with hard caps on what a single credit may
  consume (max tool calls + max output tokens).
- Staff picks the upstream model on Oracle. Today it's Deepseek Flash;
  tomorrow it can swap to Qwen / a fine-tune without any client change.

## Non-goals

- Per-organization billing. Credits are user-scoped only.
- BYOK changes. Developers keep their own provider keys; nothing in
  this plan touches that path.
- Live token streaming UX changes. Construct provider speaks
  OpenAI-compatible SSE so the operator's existing client reuses.

## Architecture

```
operator ──► gateway ──► provider-api  ──► Deepseek / Qwen / Anthropic / ...
 (desktop)   (my.cs)        (NEW, on CONSTRUCT-MAIN, Postgres)
                              │
                              ├─► credits DB (Postgres, srv-captain--postgres-db)
                              │   — catalog, models, upstream keys, ledger, balance
                              └─► oracle-api reads/writes config + grants over private net
```

**`provider-api`** (NEW) — owns everything provider-shaped.
- The provider catalog (what providers exist, their models, base URLs,
  capabilities, auth mode). Moved out of source-api.
- Construct's own multi-model managed provider (the credits piece).
- Upstream API keys (Deepseek, Anthropic, etc.) — encrypted at rest.
- Runtime SSE proxy + credit debits.
- Future home for any other managed AI surface (embeddings, image gen).

**`source-api`** (existing) — identity & org plane only after this
change. Continues to own:
- Users, sessions, OAuth, orgs, roles, members, teams, invites
- Projects, repos, org-spaces
- **BYOK keys** (`provider_keys`, `org_provider_keys`) — they're
  user/org-scoped private data and live with the user record they
  belong to, same as OAuth tokens. provider-api stays catalog-only.

**`oracle-api`** (existing) — staff control plane. Its new "AI Credits"
UI hits provider-api over the private net (`INTERNAL_SHARED_SECRET`,
same pattern as accounts/source/developer cross-talk today). No new
oracle-side DB tables; provider-api owns the data.

## What moves out of source

Two tables migrate from source MySQL to provider-api Postgres:

- `provider_catalogs`
- `provider_catalog_models`

Both are catalog-shaped (small, low write volume, no per-user FKs).
One-shot export/import. Source's `database.go` AutoMigrate list loses
those two entries; `/api/source/providers` handler deletes. The
gateway repoints `/api/providers/*` from source to provider-api.
Operator's `modelspec.load` (`operator/internal/ai/module.go:150`)
already fetches via the gateway URL, so no operator code change is
needed — the gateway just routes the same path to a different backend.

What **stays** in source: `provider_keys` (user BYOK) and
`org_provider_keys` (org BYOK). They're user data, not provider config.
The operator continues to merge BYOK keys with the catalog at runtime
in `MergeRunnerProvidersWithOAuthProviders`
(`operator/internal/ai/module.go:379`) — that join doesn't move.

## Why Postgres, not MySQL, for the ledger

`srv-captain--postgres-db` on CONSTRUCT-MAIN already hosts the
marketplace DB. Putting the credits DB next to it costs zero new infra
and gives us Postgres' append-heavy ergonomics (`INSERT ... RETURNING`,
`ON CONFLICT`, partitioning if we ever need it). MySQL on the same box
hosts source/accounts/etc. but is a worse fit for a ledger.

## Schema (new DB `credits` on `srv-captain--postgres-db`)

```sql
CREATE TABLE credits_ledger (
  id          BIGSERIAL PRIMARY KEY,
  user_id     TEXT NOT NULL,
  delta       INT  NOT NULL,            -- negative = debit, positive = grant
  kind        TEXT NOT NULL,            -- 'debit_prompt' | 'grant_paid' | 'admin_grant'
  prompt_id   TEXT,                     -- nullable; populated for debits
  meta        JSONB,                    -- upstream model id, tool_calls, output_tokens, etc.
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX credits_ledger_user_created ON credits_ledger (user_id, created_at DESC);
CREATE INDEX credits_ledger_prompt ON credits_ledger (prompt_id) WHERE prompt_id IS NOT NULL;

CREATE TABLE credits_balance (
  user_id          TEXT PRIMARY KEY,
  daily_used       INT  NOT NULL DEFAULT 0,
  daily_date       DATE NOT NULL DEFAULT (now() AT TIME ZONE 'UTC')::date,
  paid_balance     INT  NOT NULL DEFAULT 0,
  blocked          BOOL NOT NULL DEFAULT false,
  blocked_reason   TEXT,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Per-model config; oracle CRUDs this. Construct is multi-model.
CREATE TABLE credits_models (
  id                            TEXT PRIMARY KEY,            -- "construct/deepseek-chat", "construct/qwen-coder-32b"
  label                         TEXT NOT NULL,
  description                   TEXT,
  upstream_provider             TEXT NOT NULL,               -- "deepseek" | "openrouter" | "anthropic" | "self-hosted" | ...
  upstream_base_url             TEXT NOT NULL,
  upstream_model                TEXT NOT NULL,               -- model id we forward to the upstream
  credits_per_prompt            INT  NOT NULL DEFAULT 1,
  max_tool_calls_per_credit     INT  NOT NULL DEFAULT 20,
  max_output_tokens_per_credit  INT  NOT NULL DEFAULT 4096,
  capabilities                  JSONB,                       -- {"vision": true, "tools": true, ...}
  enabled                       BOOL NOT NULL DEFAULT true,
  sort_order                    INT  NOT NULL DEFAULT 0,
  created_at                    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by                    TEXT
);
CREATE INDEX credits_models_enabled_sort ON credits_models (enabled, sort_order) WHERE enabled = true;

-- Upstream provider keys, one row per upstream provider. Many
-- credits_models rows can share the same upstream_provider.
CREATE TABLE credits_upstream_keys (
  upstream_provider  TEXT PRIMARY KEY,
  api_key_encrypted  TEXT NOT NULL,
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by         TEXT
);

-- Singleton global config (one row, id=1).
CREATE TABLE credits_config (
  id               SMALLINT PRIMARY KEY DEFAULT 1,
  daily_allowance  INT  NOT NULL DEFAULT 100,
  enabled          BOOL NOT NULL DEFAULT true,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by       TEXT,
  CONSTRAINT credits_config_singleton CHECK (id = 1)
);
```

**Refund policy: none.** A credit is debited at request admission and
never returned, regardless of upstream outcome (success, error, cap
hit, mid-stream disconnect). This is intentional — it removes a class
of edge cases ("did the upstream really fail before any token?"),
keeps the per-credit cap meaningful, and means `credits_ledger` is
truly append-only with only debit + grant kinds. Operationally, if a
real outage burns credits, staff can issue `admin_grant` rows in bulk
from oracle.

Debit flow, single transaction. `:cost` is `credits_per_prompt` from
the selected `credits_models` row (1, 2, 5, ...). Daily reset happens
first; then we try to fit the cost in remaining daily allowance, and
spill any overflow into `paid_balance`. If we can't cover the full
cost, the WHERE filters out and the request is rejected with 402.

```sql
WITH today AS (SELECT (now() AT TIME ZONE 'UTC')::date AS d)
UPDATE credits_balance b
SET
  daily_used   = CASE
                   WHEN b.daily_date < t.d THEN LEAST(:cost, :daily_allowance)
                   ELSE LEAST(b.daily_used + :cost, :daily_allowance)
                 END,
  daily_date   = t.d,
  paid_balance = b.paid_balance - GREATEST(
                   :cost - (
                     CASE WHEN b.daily_date < t.d THEN :daily_allowance
                          ELSE :daily_allowance - b.daily_used
                     END
                   ), 0),
  updated_at   = now()
FROM today t
WHERE b.user_id = :user_id
  AND b.blocked = false
  AND (
    CASE WHEN b.daily_date < t.d THEN :daily_allowance
         ELSE :daily_allowance - b.daily_used
    END + b.paid_balance
  ) >= :cost
RETURNING b.daily_used, b.paid_balance;
```

The expression `(daily_remaining + paid_balance) >= :cost` is the
single admission predicate. If it holds, the row updates atomically;
if not, zero rows return → 402 from the handler.

Insert into `credits_ledger` immediately after the debit `UPDATE`
succeeds — the ledger row records the intent, not the upstream
outcome. The credit is gone either way.

Daily reset is **lazy** — `daily_date < today` triggers the reset
inside the debit `UPDATE`. No cron needed. Users who don't prompt for a
week don't accrue anything; they just see 100 next time they show up.

## provider-api shape

```
api/provider/
  main.go
  Dockerfile
  captain-definition
  .env.sample
  internal/
    config/        — caches oracle-api catalog (models, upstream keys, global config); refreshes every 60s
    upstream/      — OpenAI-compatible client; one impl serves Deepseek/Qwen/OpenRouter/Anthropic-compatible/etc.
    credits/       — gorm models + ledger debit / balance read
    handlers/
      chat.go      — POST /api/v1/chat (streaming SSE, OpenAI-compatible response shape)
      usage.go     — GET  /api/v1/usage  → { daily_used, daily_allowance, paid_balance, reset_at }
      models.go    — GET  /api/v1/models → full enabled model list with cost + capabilities
      health.go
    middleware/
      auth.go      — reads X-Auth-User-ID from gateway (rejects unauth)
      quota.go     — looks up model cost from cache, runs the debit UPDATE with :cost; 402 if not covered
```

Per-credit enforcement happens inside `chat.go` using the
`max_tool_calls_per_credit` and `max_output_tokens_per_credit` from the
selected `credits_models` row:

- Cap tool roundtrips per request. Reaching the cap ends the stream
  with `finish_reason: "credit_exhausted"`. No second credit is
  auto-charged.
- Cap output tokens per request via the upstream API's `max_tokens`.

Both caps are per-model — a vision model can have larger output cap, a
reasoning model can have more tool calls per credit, etc.

Upstream errors do not trigger refunds (see Refund policy above). If a
real outage burns a meaningful number of credits, staff can grant them
back in bulk from oracle.

## oracle-api additions

```
internal/handlers/credits.go

  # Global config (singleton)
  GET   /api/credits/config                    — { daily_allowance, enabled }
  PUT   /api/credits/config                    — staff update; audited

  # Models — full CRUD
  GET   /api/credits/models                    — list all (enabled + disabled, sort_order)
  POST  /api/credits/models                    — create
  GET   /api/credits/models/{id}               — read
  PUT   /api/credits/models/{id}               — update (any field)
  DELETE /api/credits/models/{id}              — hard delete (rare; usually toggle enabled)
  POST  /api/credits/models/reorder            — { ids: [...] } bulk sort_order

  # Upstream keys
  GET   /api/credits/upstreams                 — list providers + whether a key is set (key value masked)
  PUT   /api/credits/upstreams/{provider}      — { api_key } set or replace; audited
  DELETE /api/credits/upstreams/{provider}     — remove

  # Users
  GET   /api/credits/usage/top                 — leaderboard for abuse triage
  GET   /api/credits/users/{id}                — single-user view (balance + recent ledger)
  POST  /api/credits/users/{id}/grant          — { delta, reason } admin grant; audited
  POST  /api/credits/users/{id}/block          — { reason } sets credits_balance.blocked
  POST  /api/credits/users/{id}/unblock
```

Oracle stores `credits_models`, `credits_upstream_keys`, and
`credits_config` rows. Two placement options:

- **(a)** Oracle owns them in its own MySQL and serves them to
  provider-api on request. Symmetric with how oracle owns
  everything else config-shaped (administrators, audit, etc.).
- **(b)** The tables live in the `credits` Postgres DB alongside the
  ledger, and oracle reads/writes them over the private net.

Going with **(b)** — keeps all credits-related data in one DB
(simplifies backup, reasoning), and provider-api reads
straight from its own DB instead of doing a round-trip on every config
refresh. Oracle endpoints are thin: they hit the same Postgres
provider-api uses. The schema above lives in that one DB.

Upstream keys: stored encrypted in `credits_upstream_keys.api_key_encrypted`
using a single env-var-supplied key (`CREDITS_UPSTREAM_KEY_SECRET`)
shared by oracle (writes) and provider-api (reads). The raw
key never leaves the server.

## web/oracle UI

New "AI Credits" section in the staff nav, three sub-pages:

**1. Models** — the heart of the page.
- Table of `credits_models` rows: label, upstream provider, upstream
  model, credits/prompt, max tool calls, max output tokens, enabled,
  drag-handle for sort_order.
- "Add model" button → modal with all fields. Upstream provider is a
  dropdown of providers that have a key set in the Upstream Keys page;
  if none, prompt to add a key first.
- Inline edit for credits/prompt and caps (common tweaks).
- Toggle to enable/disable without deleting. Disabled models stop
  appearing in the public catalog within ~60s (cache refresh).
- Drag rows to reorder; bulk save via `POST /models/reorder`.

**2. Upstream Keys**
- One row per upstream provider (Deepseek, OpenRouter, Anthropic, …).
- API key field is write-only (input masked, never returned). Existing
  keys show "•••• set 3 days ago" + Replace button.
- Audit log shows who set/replaced what when.

**3. Global + Users**
- Single form: `daily_allowance` (default 100), `enabled` kill switch.
- Below: top users today (sort by `daily_used` desc) with per-row
  Block / Grant buttons that hit the user endpoints.
- Per-user drill-down → recent ledger rows.

## Public catalog entry (served by provider-api)

provider-api serves the full provider catalog at `GET /api/providers`
(routed via the gateway, same path the operator already calls — only
the backend changes). The Construct entry looks like:

```jsonc
{
  "id": "construct",
  "label": "Construct",
  "kind": "construct_managed",
  "auth": "session",           // uses the user's cat_* session, not a user-held key
  "base_url": "https://my.construct.space/api/freetier",
  "models": [                  // populated dynamically from credits_models (enabled, sort_order)
    { "id": "construct/deepseek-chat",   "label": "Deepseek Chat",        "cost": 1, "capabilities": {"tools": true} },
    { "id": "construct/qwen-coder-32b",  "label": "Qwen Coder 32B",       "cost": 1, "capabilities": {"tools": true} },
    { "id": "construct/claude-haiku",    "label": "Claude Haiku (fast)",  "cost": 2, "capabilities": {"tools": true} },
    { "id": "construct/claude-sonnet",   "label": "Claude Sonnet (smart)","cost": 5, "capabilities": {"tools": true, "vision": true} }
  ]
}
```

The `cost` field is new — the frontend picker uses it to show
"N credits" next to each model. `capabilities` drives picker icons /
filters (e.g. only show vision-capable models when the user attached
an image).

The operator's existing OpenAI-compatible provider can be reused with
`auth: "session"` meaning "no user API key required; forward the
session bearer token instead." We add that branch once in the OpenAI
client.

## operator side

New module slot for runtime decisions, but tiny:

```
operator/internal/freetier/
  module.go      — registers `freetier.usage` route that polls provider-api
                   GET /api/v1/usage and emits to UI (progress bar in composer)
```

The actual chat call goes through the standard `ai.chat_stream` path:
the provider catalog entry above makes `construct-default` look like
any other model. No new chat plumbing.

Default-model selection happens in `useAIModel.ts` (frontend):

```
last_picked_model ?? first_enabled(construct.models) ?? first_byok_model
```

- Non-developers: only Construct models are visible. Default = first
  enabled Construct model from the catalog (sort_order respected).
- Developers: Construct models + their BYOK providers. Default = last
  picked; if first run, default to first enabled Construct model.
- Adding a BYOK never auto-switches the active model. Construct stays
  available to developers as a fallback / cheap-prompt option.

Picker shows credit cost next to each Construct model
("Claude Sonnet — 5 credits"). BYOK models show their normal label
with no cost annotation.

## Gateway route (`infra-v2/deploy/gateway/`)

```
POST /api/freetier/*  →  provider-api
GET  /api/freetier/*  →  provider-api
  - requires valid cat_* session
  - injects X-Auth-User-ID, strips Authorization
```

## Rollout

1. **Phase 1 — infra + service skeleton**
   - Create `credits` DB on existing `srv-captain--postgres-db`
   - Scaffold `api/provider/`; wire CapRover app + Dockerfile;
     auto-deploy from `construct-space/provider-api`
   - Add migrations: `provider_catalogs`, `provider_catalog_models`,
     `credits_ledger`, `credits_balance`, `credits_models`,
     `credits_upstream_keys`, `credits_config`
   - Verify debit transaction (with variable :cost) in isolation
2. **Phase 2 — catalog migration out of source**
   - Read-only `GET /api/providers` in provider-api, seeded by a one-shot
     copy of source's `provider_catalogs` + `provider_catalog_models`
   - Gateway: repoint `/api/providers/*` from source to provider-api
   - Verify operator's `modelspec.load` still works end-to-end
   - Drop the two tables from source's AutoMigrate list; delete the
     source handler; remove unused source models
3. **Phase 3 — control plane**
   - provider-api endpoints: full CRUD for models, upstream keys,
     global config, user grant/block
   - Oracle UI: Models / Upstream Keys / Global+Users pages — calls
     provider-api over private net with `INTERNAL_SHARED_SECRET`
   - Audit on all writes (oracle continues to own audit log)
   - Seed launch lineup (Deepseek Chat, Qwen Coder, Claude Haiku,
     Claude Sonnet) + corresponding upstream keys
4. **Phase 4 — data plane**
   - Chat handler (OpenAI-compatible SSE passthrough)
   - Model lookup → per-model upstream client → per-credit caps
   - Usage endpoint, models endpoint
5. **Phase 5 — client**
   - Add `auth: "session"` branch to operator's OpenAI client
   - Frontend: non-dev default + credit progress bar + per-model cost
     in picker
6. **Phase 6 — paid credits (Polar)**
   - See `project_polar_metered_billing_plan.md` — credits become the
     metered unit, top-up writes a `grant_paid` row

## Open questions

- **Abuse signal threshold.** When do we auto-block? Plan: alert only
  in phase 1, no auto-block. Decide threshold after a week of data.

## Out of scope (explicitly)

- Org-pooled credits
- Streaming token-level pricing display
- Self-serve key entry by non-developers
- Per-space allowances
