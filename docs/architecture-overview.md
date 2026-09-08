# Construct — System Architecture Overview

> Internal reference. Spans every repo (web, desktop, mobile, TV, api/*).
> Last mapped: 2026-06-02 from source.

## The one-sentence version

Every **client** (web, desktop, mobile, TV) talks to a single edge —
**`my.construct.space`**, an nginx gateway — which authenticates once against
**accounts** and fans out to ~20 internal Go services on a private network. On
top of that sits an **execution mesh** (Conductor + operators + space-runtime)
that turns your **desktop into a personal AI operator** other devices can
reach, with a cloud fallback when it's offline.

## Diagram

```mermaid
flowchart LR
  subgraph Clients
    web["web/my · oracle · website"]
    desk["desktop (Vue+Tauri+Go brain)"]
    mob["mobile (Flutter)"]
    tv["TV (Vue + Kotlin kiosk)"]
  end

  subgraph Edge
    gw["my.construct.space<br/>nginx gateway<br/>validates token →<br/>injects X-Auth-* + X-Internal-Secret"]
  end

  subgraph Services["Internal services (private net)"]
    acc["accounts<br/>(auth authority)"]
    src["source<br/>(device bus, scheduler)"]
    graph["graph (data)"]
    prov["provider → inference"]
    other["developer · marketplace · billing<br/>delivery · storage · domains · ..."]
  end

  subgraph Mesh["Execution mesh"]
    cond["Conductor<br/>(control plane: claim/report)"]
    op["DESKTOP brain OR CLOUD operator"]
    rt["space-runtime<br/>(headless exec)"]
  end

  web -->|http| gw
  desk -->|http| gw
  mob -->|http| gw
  tv -->|http| gw
  mob -.device-bus WS.-> src
  tv -.device-bus WS.-> src

  gw --> acc & src & graph & prov & other
  acc -. validate-token .- gw
  Services -. X-Internal-Secret .- Services

  cond -->|polls| op
  op -->|space_run_action| rt
  rt --> graph
  op -. claim/report .- cond
```

## 1. Clients (surfaces)

| Surface | Stack | Domain | What it is |
|---|---|---|---|
| **web/my** | Vue 3 SPA + bundled nginx | `my.construct.space` | Unified portal **and** the gateway itself — the single public edge |
| **web/oracle** | Vue 3 SPA | `oracle.construct.space` | Staff admin → `oracle-api` (session-cookie auth) |
| **web/website** | Nuxt 4 | `construct.space` | Marketing + blog + space catalog (build-time fetch) |
| **web/delivery, web/domains** | Vue 3 | `construct.delivery`, domains | Thin tenant UIs; primary UX folded into `my` |
| **desktop** | Vue 3 + Tauri 2 + Go "brain" | native | Full IDE/runtime **and** your local AI operator |
| **mobile** `apps/construct` | Flutter | — | Ask your desktop operator; notifications (FCM) |
| **TV** `apps/construct_tv` + `tv-android` | Vue SPA embedded in `api/tv`; Kotlin WebView | `tv.construct.space` | Ambient voice dashboard (weather, mail, calendar widgets) |

All speak to **one base URL** (`my.construct.space/api/*`) except a few direct
channels (Conductor, Graph realtime, TV's embedded backend).

## 2. Edge — gateway + auth (backbone #1)

`web/my/nginx.conf.template`. Every `/api/*` request:

1. `auth_request` subrequest → **accounts** `/internal/validate-token`
2. Accounts validates the `cat_*` token (or `csk_live_*` publisher key), returns identity headers
3. Gateway **injects** `X-Auth-User-ID / -Org-ID / -Roles` + shared **`X-Internal-Secret`** onto the upstream
4. Routes to the right `srv-captain--*` / private-IP upstream

Services never see raw tokens — they trust `X-Auth-*` **only** because
`X-Internal-Secret` proves the call came from the gateway. Service-to-service
calls reuse the same secret. This is the most important pattern in the backend.

**Tokens:**
- `cat_*` — user identity (Bearer). Every client carries it.
- `csk_live_*` — publisher key (X-API-Key) for org space publishing.
- `cd_live_*` — delivery API key (programmatic email/notif).
- **delegated token** — short-lived (900s) `cat_*` minted by accounts so a *cloud* operator can act as you without holding your credential.

## 3. Services (the mesh)

**accounts** is the auth authority. Everything else owns one domain, reached via the gateway:

- **source** — device bus, operator catalog, scheduler, CLI/org ops (cross-device nerve center)
- **graph** — multi-tenant data store + GraphQL (org resolved from token)
- **provider → inference** — model router → Together.ai/Construct LLM backends (source-family operators: Tank/Trinity/Apoc)
- **developer + marketplace** — space publish→review→approve + public catalog
- **billing** (Polar), **delivery** (email/push/FCM), **integration** (Gmail), **storage** (R2), **domains** (DNS/DKIM), **telemetry/tracker/status**
- **turn-auth** — WebRTC TURN credentials (Meet/casting)
- **oracle** — staff control plane; proxies admin endpoints across developer/graph/accounts/provider
- **space-runtime** — the only Bun/TS service; headless space-action executor

## 4. Execution mesh (backbone #2)

- **Conductor** (`api/conductor`) owns rules + schedule + leases. Never runs agents or touches data.
- **Desktop brain** polls Conductor ~20s (`/api/claim` as `executor_id:"desktop"`), runs the rule as a restricted reactor agent (space actions + read + web + memory; **no** write/bash/git), then `/api/report`.
- **Presence + lease** = local-first: Conductor yields to the desktop for a 90s grace window. Only after the desktop goes silent does a **cloud operator** claim via `X-Internal-Secret`, get a **delegated token**, and run the same agent.
- Both invoke space actions via the **capability router** (`space_run_action`): webview bridge first (desktop, fast) → **space-runtime** fallback (cloud, sandboxed child process, signature-verified bundle, scrubbed env, 120s timeout).

## 5. Key flows — how they work together

**📱 Mobile → desktop.** Mobile `POST /api/device-bus/relay {type:"assistant.ask"}` → source device-bus → desktop (subscribed over WS) runs locally → streams `assistant.chunk`/`assistant.complete` back → mobile renders live.

**📱 Mobile → desktop offline.** Source checks operator status; if offline it calls the **cloud operator** `POST /internal/ask` (your token + `X-Internal-Secret`), publishes the answer back on the same bus. Mobile can't tell the difference.

**📺 TV pairing + ambient.** TV `POST /api/device/start` → shows code → you enter it in desktop Settings (`/api/device/link`) → TV polls `/api/device/poll`, gets a delegated `cat_*` + HMAC refresh. Voice query → `/api/ask` → matches a TV widget or asks inference → renders space widgets that fetch your real data via TV's same-origin `/api/source` + `/api/graphql` proxies.

**🕒 Scheduled automation.** Conductor marks a rule due → desktop claims (or cloud after 90s) → reactor agent runs space actions via space-runtime → reports back. Separately, the **source scheduler** (`useScheduler` + `notify`) fires recurring work via device-bus `scheduler.claim_now` wake events (devices race to claim).

**💻 Web → anything.** Browser hits `my.construct.space/api/<service>/...` → gateway auths once → injects identity → internal service responds. Same path the desktop and CLI use.

## 6. Status — live vs scaffolded

- ✅ Gateway, auth, all user-facing services, desktop operator + claim loop, device bus, TV pairing, mobile ask→desktop
- 🟡 **Cloud operator + automation cloud-fallback**: built, branches pushed, **not deployed** — inert until `OPERATOR_URL` is set and the cloud-executor auth model (delegated token vs org service key vs encrypted escrow) is finalized. Today the **desktop is effectively the only executor** — automations run when your machine is on.

## Source map (where to look)

| Area | File |
|---|---|
| Gateway routing + auth | `web/my/nginx.conf.template` |
| Token validation | `api/accounts` `/internal/validate-token`, `api/go-auth` |
| Conductor claim/report/lease | `api/conductor/{main,store,delegate}.go` |
| Desktop executor | `construct-app/brain/automation.go` |
| Capability router | `construct-app/brain/tool/space_runtime.go` |
| Headless exec | `api/space-runtime/src/{server,runtime,worker}.ts` |
| Device bus + cloud fallback | `api/source/internal/handlers/devicebus_cloud.go` |
| Scheduler notifier | `api/source/internal/scheduler/notifier.go` |
| Mobile ask | `apps/construct/lib/src/assistant/client.dart` |
| TV pairing | `api/tv/device.go`, `apps/construct_tv/src/App.vue` |
| Execution-mesh ADR | `construct-app/docs/2026-05-30-execution-mesh.md` |
