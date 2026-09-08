# Execution mesh — automations that run when the desktop is closed

Status: **scaffolded + locally testable** (2026-05-30). Not deployed.

## The problem

Automations ("when I get a meeting invite, add it to my calendar") lived in
the brain, fired by a `time.Ticker` inside the desktop process. A clock in a
process that isn't running fires nothing — so automations only worked while
Construct was open. We want them to run on a machine you own when it's on, and
fall back to the cloud only when it isn't — without moving everything to the
cloud.

## The shape

```
            ┌────────────────────────────────────────────┐
            │  CONDUCTOR  (always-on control plane)        │
            │  owns rules + schedule + claim/lease.        │
            │  NEVER runs the agent or touches app data.   │
            └───────────────▲───────────────┬─────────────┘
              claim/report   │               │ claim/report
                             │               │
            ┌────────────────┴───┐     ┌─────┴──────────────┐
            │ EXECUTOR: desktop  │     │ EXECUTOR: cloud    │  (fallback)
            │ brain + space-rt   │     │ brain + space-rt   │
            │ (preferred)        │     │ (only when desktop │
            └─────────┬──────────┘     │  is offline)       │
                      │                └─────────┬──────────┘
                      │ space_run_action          │
            ┌─────────▼───────────────────────────▼─────────┐
            │ CAPABILITIES: space actions (actions.ts)       │
            │ run headless via space-runtime over Graph      │
            └────────────────────────┬───────────────────────┘
                                     │
                            ┌────────▼────────┐
                            │ DATA: Graph      │  (org resolved from token)
                            └─────────────────┘
```

- **Conductor** (`api/conductor/`) — control plane. Owns the rules, the
  schedule, and a per-rule **lease**. Coordinates only; never computes.
- **Executors** — claim a due rule, run it, report. The **desktop brain** is
  the preferred executor (it claims first when online). A **cloud executor**
  is the fallback. The lease stops both from running the same rule.
- **space-runtime** (`api/space-runtime/`, own repo `construct-space/space-runtime`) — runs a space's
  `actions.ts` against Graph with no webview, token injected per request.
- **Graph** — data. Resolves user + org from the token server-side.

Reframe: the desktop is **a preferred executor + a surface**, not "the app."
Local-first here means *sovereign execution* — runs on a machine you own.

## What's built

| Piece | Where | State |
|---|---|---|
| Conductor service | `api/conductor/` (own git repo, local-only) | builds, tests pass, Dockerfile ready |
| Brain claimer | `construct-app/brain/automation.go` | committed; `CONDUCTOR_URL`-gated, local-ticker fallback |
| Capability router | `brain/tool/space.go` + `space_runtime.go` | committed (`72bd688`): bridge-first, runtime-fallback |
| space-runtime | `api/space-runtime/` (own repo, moved 2026-05-31) | committed; **proven headless** (real calendar events); Dockerfile added (build-unverified — no Docker daemon at author time) |

Everything new is **additive + env-gated**. With `CONDUCTOR_URL` unset the
brain uses the old local ticker; with the space-runtime down the router uses
the webview bridge exactly as before. Nothing changes by default.

## Local end-to-end test (works today, no Docker, no cloud)

Three terminals. Replace `<URL>` ports if taken.

**1. Conductor** (dev-user bypass so you don't need a live accounts):
```bash
cd api/conductor
CONDUCTOR_DEV_USER=local-test CONDUCTOR_DATA_DIR="$HOME/.construct-conductor" PORT=8090 go run .
```

**2. space-runtime** (headless space executor):
```bash
cd api/space-runtime
bun src/server.ts        # listens on :60190
```

**3. brain as an executor** — launch the app with the two envs set so the
brain claims from Conductor and routes actions to the space-runtime:
```bash
cd construct-app
CONDUCTOR_URL=http://127.0.0.1:8090 \
CONSTRUCT_SPACE_RUNTIME_URL=http://127.0.0.1:60190 \
bun run dev
```

**4. Create a rule** (until the Automations UI is wired to Conductor):
```bash
curl -s -H 'Authorization: Bearer x' -H 'Content-Type: application/json' \
  -X POST http://127.0.0.1:8090/api/automations \
  -d '{"instruction":"List my next 3 calendar events and remember a one-line summary.","interval_min":1,"enabled":true}'
```

**5. Watch it fire** — within ~20s the brain claims it, runs the reactor
(calendar action via the space-runtime, since a headless run has no webview),
and reports:
```bash
curl -s -H 'Authorization: Bearer x' http://127.0.0.1:8090/api/automations \
  | python3 -m json.tool          # last_result populated, leased_by empty
```

The control-plane loop alone (create → desktop claims → cloud blocked by lease
→ report → not-due) is covered by `api/conductor/store_test.go` and was also
verified end-to-end over HTTP.

## Cloud executor — deploy plan + the one open decision

The cloud executor is the *same* two processes as the desktop executor — the
brain (as a Conductor executor) and space-runtime — in a container, claiming
from the same Conductor. `docker-compose.cloud.yml` (skeleton, in
`api/conductor/`) wires Conductor + space-runtime and leaves the brain service
with its image build + auth as the marked TODO.

**Blocking decision before a cloud executor can run unattended:**
how does it authenticate *as the user* and get *provider keys*?

- The desktop executor reads the live profile token (`IdLoader.Current()`)
  and provider/org keys from the signed-in profile. A cloud box has neither.
- Options to discuss when you're awake:
  1. **Delegated executor token** — Conductor (or accounts) mints a narrow,
     short-TTL token scoped to "run automations for user X"; the cloud
     executor presents it to Graph + source. Cleanest; needs an accounts
     endpoint.
  2. **Org service key** — cloud executor uses an org `csk_live_*` key for
     org-scoped automations only; personal automations stay desktop-only.
  3. **Encrypted token escrow** — user opts in; token stored encrypted,
     handed to the cloud executor on claim. More surface, least preferred.

Until that's decided, **the desktop is the only executor** and automations
run when your machine is on — which is already the behavior we wanted to fix
for the common case, just without the cloud safety net yet.

## Not done overnight (deliberately)

- No new prod service deployed; live `source`/device-bus untouched.
- Automations settings UI still talks to the brain's local store, not
  Conductor — wiring it over is the next desktop task.
- Cloud executor auth (above) is a decision, not code, for now.
- Conductor has no remote git repo yet (local commit only) — creating the
  GitHub repo + first push is left for your confirmation.
