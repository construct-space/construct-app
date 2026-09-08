# Automations — Scheduler + Pulses

**Status:** Architecture locked, implementation not started.
**Supersedes:** `2026-05-17-scheduler.md`, `2026-05-20-heartbeats.md`.

This document covers Construct's full automation system — both layers,
designed together, shipped as one feature.

- **Scheduler** is the host-level cron primitive: one cloud-synced job
  table, used by Pulses, Calendar reminders, Mail snooze, Send-later,
  and system jobs (update check, log rotation, token refresh).
- **Pulses** is the user-facing feature built on top: a built-in Space
  for creating recurring summaries, watchers, and reminders.

Settings → **Automations** is the host page that surfaces *every*
scheduled task across all of them.

---

## Core principles

1. **Scheduler is the primitive.** One host-level cron runner,
   cloud-synced, used by everything. Lives in `api/source` (not a new
   service).
2. **Pulses is a space.** Built-in, but architecturally a normal
   Construct space — owns its graph schema, UI, agent tools, runner.
   Iterates independently of host releases.
3. **Cloud is connectivity, never execution.** Definitions, state,
   claims, push-wake — all cloud. Recipe execution + LLM calls +
   streaming — always on the user's device.
4. **Brain stays local.** Chat streams stay direct (provider → brain
   → UI). Pulses inherit the same property: provider → local brain
   → final summary reported to cloud.
5. **Every identity reference is `{ kind: 'user' \| 'org', id }`.**
   Personal and org pulses use the same shape; org features are
   additive, not a migration.
6. **Delivery channel = storage.** No retention layer for summaries;
   if you want to search them, ask the relevant space (Mail, WhatsApp,
   etc.) via the agent.

---

## What's where

```
┌─ api/source ────────────────┐  ┌─ api/graph (existing) ─────┐
│ identity + scopes           │  │ pulses-space schema:       │
│ scheduler (tasks + claims)  │  │  · Pulse                   │
│ push wake (FCM/APNS) + WS   │  │  · PulseTemplate           │
│ billing ledger              │  │ all sync via graph         │
└─────────────────────────────┘  └────────────────────────────┘
            ▲                              ▲
            └──────────────┬───────────────┘
                           │
        ┌──────────────────┴───────────────────┐
        │  Each user device                    │
        │   · pulses-space (built-in)          │
        │       runner, UI, agent tools        │
        │   · scheduler SDK (host composable)  │
        │   · notification bell + OS notify    │
        │   · set_keep_awake (Tauri command)   │
        └──────────────────────────────────────┘
```

**No new CapRover services.** Source gets the scheduler tables +
endpoints. Graph stores all pulses-space data. The whole feature
ships as: source migration + new pulses-space + an oracle-web admin
page (for org templates, later) + host-side bits (always-on toggle,
notification rendering, scheduler SDK composable).

---

## Naming

User-facing feature: **Pulses**. Single word, used for the UI string,
the agent's vocabulary, and the data type.

Host umbrella page: **Settings → Automations**. The broader category
view across pulses + calendar reminders + mail snoozes + system jobs.
Users distinguish: "I set up a *pulse*" vs "I see all my *automations*
in Settings."

Pulses chosen for grammar fit (set up / pause / runs every X) +
Matrix-adjacent (EMP pulses are Zion tech) with a useful dual reading
on rhythm.

---

# Part 1 — Scheduler

The host primitive every other automation feature builds on.

## Tables (in source)

```sql
scheduled_tasks
  id uuid pk
  owner_kind text          -- 'user' | 'org' | 'system'
  owner_id uuid
  owner_space text         -- 'pulses' | 'calendar' | 'mail' | 'system'
  owner_entity_id text     -- pulse id, event id, thread id, …
  title text
  schedule jsonb           -- {kind: 'interval' | 'daily' | 'weekly' | 'once'}
  action jsonb             -- space-defined; runner doesn't interpret
  enabled boolean
  state jsonb              -- lastFiredAt, nextRunAt, lastError, …
  created_at, updated_at

scheduled_claims
  task_id uuid
  scheduled_for timestamptz
  claimed_by_device text
  claimed_at, expires_at timestamptz
  pk (task_id, scheduled_for)

devices
  id text pk
  user_id uuid
  scopes jsonb             -- [{kind:'user', id:userId}, {kind:'org', id:...}]
  platform text            -- 'macos' | 'linux' | 'windows' | 'ios' | 'android'
  push_token text
  last_seen_at timestamptz
  capabilities jsonb       -- has_lm_studio, has_ollama, …
```

## Endpoints (added to source)

```
POST   /v1/scheduler/tasks                       create
GET    /v1/scheduler/tasks?owner_space=pulses    list (scope-filtered)
PATCH  /v1/scheduler/tasks/:id                   edit
DELETE /v1/scheduler/tasks/:id                   delete
POST   /v1/scheduler/tasks/:id/run-now           ad hoc fire

POST   /v1/scheduler/devices/register            {device_id, platform, push_token, scopes}
POST   /v1/scheduler/devices/:id/heartbeat       last-seen ping (every 60s while open)
POST   /v1/scheduler/tasks/:id/claim             atomic claim, returns 409 on race loss
POST   /v1/scheduler/tasks/:id/report            outcome + state, fans out to other devices
GET    /v1/scheduler/ws                          push channel: "claim now: <task_id>"
```

## Scheduler loop

```
every 5s:
  for each (task, due_at) where due_at <= now and not yet claimed:
    online_devices = devices_with_matching_scope_and_capability(task)
    if online_devices:
      best = pick_best(online_devices, task)   # AC > battery; recent > stale
      push_wake(best, task, due_at)            # ws first, fcm/apns fallback
      record_claim(task, due_at, best, ttl=60s)
    else:
      mark_deferred(task, due_at)

every 60s:
  reclaim claims that expired (device went offline mid-run)
```

## Claim protocol

```
1. device receives wake (ws or push)
2. POST /v1/scheduler/tasks/:id/claim {scheduled_for}
   → 200 if device holds the claim, 409 if another device beat it
3. device executes locally
4. POST /v1/scheduler/tasks/:id/report {outcome, state}
   → server fans out result to other devices over ws
```

One task, one fire — devices race for claims via SKIP-LOCKED semantics.
Devices serve the union of scopes their user belongs to.

## Scheduler SDK (host composable)

```ts
const sched = useScheduler()

sched.create({
  owner_space: 'pulses',       // host validates caller's manifest
  owner_kind: 'user',          // or 'org'
  owner_id,
  owner_entity_id: pulseId,
  title: 'Mail summary',
  schedule: { kind: 'interval', everyMinutes: 5 },
  action: { kind: 'pulses.run', pulseId },
})

sched.list({ owner_space: 'pulses' })
sched.pause(taskId)
sched.runNow(taskId)
sched.cancel(taskId)
sched.onFire(taskId, handler)        // space registers callback
```

Host enforces that a space can only create/edit tasks where
`owner_space` matches its manifest id. Settings → Automations is the
only place with cross-space authority (granted by being host UI).

## Settings → Automations (host page)

```
SETTINGS › AUTOMATIONS

⚡ Keep Construct always on        [ ON ]
   ✓ Active — preventing idle sleep
   ☑ Only on AC power (recommended)

──────────────────────────────────────────────────
SCHEDULED TASKS                ALL · ACTIVE · PAUSED · ERRORED
Filter:  Owner: [ All ▾ ]   Scope: [ All ▾ ]

System
  ⏰  Check for updates           Daily 04:00     next in 11h
  ⏰  Refresh OAuth tokens        Every 6h        next in 2h
  ⏰  Pulse history cleanup       Daily 03:00     next in 10h

Pulses
  📬  Mail summary                Every 5 min     next in 2m
  📅📬✓  Morning briefing          Daily 09:00     next in 14h

Calendar
  🔔  Team standup reminder       Once 08:50      tomorrow
  🔔  Marketing review reminder   Once 13:50      Thu

Mail
  💤  Snoozed: "Q4 planning"      Once 09:00      tomorrow
  📤  Send later: "Re: invoice"   Once 18:00      today
```

Per-row actions (pause / resume / cancel / run-now) are available from
here for power users, but the normal flow is to manage tasks from the
owning space's UI (delete the event → its reminder auto-cleans up
because the space cancels its own tasks).

## Always-on toggle

Single host-level toggle. Asserts an OS power assertion while ON.

| OS | API |
|---|---|
| macOS | `IOPMAssertionCreateWithName("PreventSystemSleep")` via Tauri command |
| Linux | DBus `org.freedesktop.PowerManagement.Inhibit` (or `systemd-inhibit --what=idle:sleep`) |
| Windows | `SetThreadExecutionState(ES_SYSTEM_REQUIRED \| ES_CONTINUOUS)` |

Sub-option **"Only on AC power" — default ON.** Prevents the
"my laptop died on the train because Construct kept it awake" case.
On battery the device sleeps normally; tasks queue, fire when it
wakes.

macOS clamshell sleep is a separate beast — `caffeinate` doesn't
block lid-close sleep without external display. We surface this
honestly in the toggle's help text. The real answer for "always
available" is an always-on box (see [Always-on box](#always-on-box)).

System jobs (update check, log rotate, token refresh) are bootstrapped
once by the host as `owner_space: 'system'` rows. Visible here,
editable with confirmation warnings.

---

# Part 2 — Pulses

The user-facing feature: a built-in space that uses the scheduler
to run recurring (or one-shot) recipes.

## Manifest highlights

```json
{
  "id": "pulses",
  "label": "Pulses",
  "builtin": true,
  "audience": "both",
  "surface": "sidebar",
  "permissions": {
    "scheduler": true,
    "notifications": true,
    "power_management": true,
    "cross_space_dispatch": true
  },
  "graph_schema": {
    "Pulse": { ... },
    "PulseTemplate": { ... }
  },
  "actions": {
    "list":       { "mutation": "none" },
    "create":     { "mutation": "reversible" },
    "update":     { "mutation": "reversible" },
    "delete":     { "mutation": "destructive" },
    "toggle":     { "mutation": "none" },
    "run_now":    { "mutation": "none" },
    "propose":    { "mutation": "none" }
  },
  "pulse_recipes": []
}
```

## Graph schema

```ts
model Pulse {
  id, ownerKind, ownerId,           // 'user' | 'org' — multi-scope ready
  source,                            // see below
  enabled, title,
  schedule, recipe, delivery, model,
  state: PulseState,
  createdAt, updatedAt
}

type Pulse.source =
  | 'manual'
  | { kind: 'agent', sessionId }
  | { kind: 'org', orgId, templateId }
  | { kind: 'suggestion', source: 'install_card' | 'recommended_section' | 'chat' }

type PulseState = {
  lastRunAt, lastSuccessAt, nextRunAt
  lastOutcome: 'success' | 'quiet' | 'error'
  lastResultBlurb: string           // one-liner for UI: "3 new threads"
  seenKeys: string[]                // dedupe — bounded to 1000 or 30d
  consecutiveErrors: number
  recentErrors: ErrorRecord[]       // ring buffer, last 10
}

model PulseTemplate {
  id, ownerKind: 'org', ownerId,
  title, description, schedule, recipe, delivery, model,
  locked: 'recipe',                  // members can edit schedule + delivery only
  createdAt, updatedAt
}
```

**No `PulseRun` history table.** The delivery channel is the storage
for summaries — see [Retention](#retention).

## Schedule types

```ts
type Schedule =
  | { kind: 'interval', everyMinutes: number }
  | { kind: 'daily', time: 'HH:mm' }
  | { kind: 'weekly', weekdays: number[], time: 'HH:mm' }
  | { kind: 'once', at: ISOString }   // auto-disables after firing
```

One-shot pulses (`once`) stay disabled after firing with a "Reminder
fired" badge — user can delete or re-enable to reuse.

## Recipe shapes

One shape, three step kinds. Single-space, multi-space, and pure
reminder all use the same recipe type.

```ts
type Recipe = { kind: 'recipe', steps: Step[] }

type Step =
  | { action: string, spaceId: string, params?, as?: string }
  | { summarize: string, inputs?: string[] }
  | { reminder: string }
```

**Single-space pulse** (Mail every 5 min):
```ts
steps: [
  { action: 'listThreads', spaceId: 'mail',
    params: { label: 'INBOX', q: 'is:unread', max: 10 }, as: 'mail' },
  { summarize: 'Summarize new important threads since last run.' }
]
```

**Multi-space digest** (morning briefing):
```ts
steps: [
  { action: 'listEvents',  spaceId: 'calendar', params: { day: 'today' }, as: 'events' },
  { action: 'listThreads', spaceId: 'mail',     params: { q: 'is:unread', max: 5 }, as: 'mail' },
  { action: 'listToday',   spaceId: 'tasks',                                          as: 'tasks' },
  { summarize: 'Give me a 5-bullet morning briefing using events, mail, tasks.' }
]
```

**Pure reminder:**
```ts
steps: [ { reminder: 'Drink water' } ]
```

Runner iterates steps, accumulates results keyed by `as`, then
executes the `summarize` step against the accumulated map. Same
code path for all three shapes.

## Summarization contract

Default summary structure is two buckets — the summarize step prompt
encodes this:

```
NEEDS ATTENTION — items that need a decision, response, or action.
  Include: who, what they want, when by.

FYI — informational items, notifications, low-priority updates.
  Compress aggressively: one paragraph total, not per-item.

If a bucket is empty, omit it.
If the entire result is FYI-only with no new items,
  mark this run as 'quiet'.
```

No fetch-depth tiers (metadata-only by default; if the user wants
deeper analysis they ask the agent, which can call `mail.getThread`
or equivalent interactively in chat).

## Runner

```ts
async function runPulse(pulse: Pulse) {
  const scopeToken = await getScopeToken(pulse.ownerKind, pulse.ownerId)
  await withScope(scopeToken, async () => {
    const results: Record<string, unknown> = {}
    for (const step of pulse.recipe.steps) {
      if ('action' in step) {
        results[step.as ?? step.action] =
          await bridge.spaceRunAction(step.spaceId, step.action, step.params)
      } else if ('summarize' in step) {
        results.summary =
          await brain.summarize(pulse.model, step.summarize, pickInputs(results, step.inputs))
      } else if ('reminder' in step) {
        results.summary = step.reminder
      }
    }
    await dispatchDelivery(pulse, results, scopeToken)
    await persistState(pulse, results)
  })
}
```

Recipe execution **inherits the pulse's scope** — bridge calls to
other spaces automatically use the right identity context, so an
Acme-org pulse running `mail.listThreads` gets work mail, not personal.

## Mutation classification

Space-author classifies each action in the manifest:

```json
{
  "actions": {
    "listThreads": { "mutation": "none" },
    "archive":     { "mutation": "reversible" },
    "delete":      { "mutation": "destructive" }
  }
}
```

Pulse runner enforces:

- All `none` actions: run silently.
- Any `reversible` action: defaults to **confirm-per-run**.
  Notification arrives with proposed action + Approve button; 6-hour
  window before action expires.
- Any `destructive` action: **only** allowed with `confirm-per-run`.
  Can't opt out.
- Per-pulse toggle "Run mutations without asking" unlocks autonomous
  reversible mutations (still blocked for destructive). Defaults off;
  requires an extra "I understand this acts on its own" confirmation
  when flipped.

Confirmation notification:

```
┌──────────────────────────────────────────────────┐
│ ⚡  Standup post ready                           │
│                                                  │
│  Draft based on yesterday's commits:             │
│  "Yesterday I finished the LMStudio routing fix  │
│   and started the pulses plan. Today: …"         │
│                                                  │
│  Will post to #team in 6h if not approved.       │
│                                                  │
│        [ Edit ]  [ Reject ]  [ Approve ]         │
└──────────────────────────────────────────────────┘
```

## Model selection

Per-pulse `model` field:

```ts
type ModelTier =
  | 'cheap' | 'balanced' | 'best'
  | { kind: 'specific', id: string }
```

Tiers map per-provider:

| Tier | BYOK Anthropic | BYOK OpenAI | Construct (Source) | Local |
|---|---|---|---|---|
| cheap | Haiku 4.5 | gpt-4.1-mini | Source cheap | whatever's loaded |
| balanced | Sonnet 4.6 | gpt-5 | Source balanced | — |
| best | Opus 4.7 | gpt-5-pro | Source premium | — |

**Default: cheap.** Pulses are short structured summaries — Haiku's
wheelhouse. Agent escalates only with explicit reason in the user's
request.

If the user swaps providers, tier mappings silently rebind — no
migration needed.

## Cost display

Three modes by provider class:

| Provider class | Display | Internal tracking |
|---|---|---|
| Construct Source / gateway | `🪙 ~120 credits/wk · cheap` | Credits ledger |
| BYOK (Anthropic, OpenAI, …) | `🪙 ~$0.04/wk · cheap · haiku-4.5` | Tokens × USD/token |
| Local (LM Studio, Ollama, BaseMLX) | `💻 Free · local · llama-3.1-8b` | Tokens (telemetry only) |

Icon shifts (💻 vs 🪙) so the user can see at a glance whether a pulse
is costing anything.

Local pulses also display a privacy note in the editor:

```
🔒  Local pulse — your data stays on this device.
   Note: this pulse can only run when your computer is on
   and the model is loaded in LM Studio.
```

Local pulses have stricter scheduler routing: only claimed by devices
where the required runtime is present + reachable.

## Delivery channels

Pluggable. Host provides bell + OS notification + email; any space can
declare a `delivery_target: true` action to be a channel.

```ts
type DeliveryChannel =
  | { kind: 'bell' }
  | { kind: 'os_notification' }
  | { kind: 'email', to: string }
  | { kind: 'space', spaceId: string, action: string, params? }
```

Space declares:

```json
{
  "actions": {
    "sendMessage": {
      "delivery_target": true,
      "params_schema": { "to": "string", "body": "string" },
      "label": "Send a WhatsApp message"
    }
  }
}
```

Pulses-space's editor reads the space registry, filters to spaces
declaring `delivery_target`, offers them as channels:

```
DELIVER VIA

  ☑  In-app bell                       [ always ]
  ☑  OS notification           [ when not quiet ]
  ☐  Email                  to: ______________
  ☑  WhatsApp               to: my-self chat
  ☐  Slack                  to: #me

  [ + Add channel from another space ]
```

Multi-channel out of the box. Each can independently be "always" or
"only when not quiet."

Delivery to a space respects scope: an org pulse delivering to
WhatsApp uses the org's WhatsApp space; a personal pulse uses the
user's. Missing destination space in the current scope →
broken-reference row in the pulse list.

## Notification policy

- **Quiet runs** (nothing new): history-only, never bell, never OS notify.
- **Bursts**: OS notifications batch within a 30s rolling window —
  first pulse fires, any pulse completing within 30s joins the same
  banner. In-app bell entries stay granular.
- **OS notification ID = pulse ID.** Stable identifier means a new
  run while the previous notification is still pending automatically
  **replaces** the previous one (native iOS + Android + macOS
  behavior). No stacking, no state to track.
- **Wake / missed-run replay** when a device reconnects:
  ```
  if recipe is reminder + schedule is once:  fire (with "scheduled at X" annotation)
  elif schedule is interval:                  fire one run now; collapse missed to single row
  elif schedule is daily or weekly:           fire most recent missed (with annotation)
  ```

## Retention

No retention layer. Delivery channels store summaries; pulses-space
stores only:

- Pulse definition + state (`PulseState` above)
- `seenKeys` (bounded — last 1000 entries or 30 days, whichever smaller)
- `recentErrors` ring buffer (last 10 for debugging)

If the user wants to find a summary from a month ago, they ask the
agent: *"find that Mail summary about Q3 planning"* → agent routes
to Mail's search via cross-space dispatch. Search is the delivery
channel's job, not pulses'.

Optional metadata tag on delivered messages (e.g.
`X-Construct-Pulse: <pulseId>` header on emails) lets the agent's
search filter to pulse-delivered specifically. Cheap, optional.

## Pulses page UX

```
PULSES                                      [+ New pulse]

YOUR PULSES                       ALL · ACTIVE · PAUSED

📬  Mail summary                              [ ON ]
    Every 5 min · last run 2m ago · 3 new threads
    🪙 ~120 credits/wk · cheap
    [ Run now ] [ Edit ] [ ⋯ ]

📅📬✓  Morning briefing                       [ ON ]
       Daily 09:00 · last run today
       🪙 ~480 credits/wk · cheap

⏰  Drink water                                [ ON ]
    Daily 14:00 · last run today

🎯  Project activity                           [ OFF ]
    Paused — token expired.
    [ Reconnect ]  [ Edit ]  [ Delete ]
```

Icon strip on each row tells the user instantly whether it's
single-space, cross-space digest, or pure reminder. No "always-on
toggle" here — it lives in Settings → Automations because it affects
every scheduler-backed feature, not just pulses.

**Empty state** pushes toward chat:

```
You don't have any pulses yet.

Pulses run on a schedule and surface what changed —
new mail, calendar events, project activity.

Tell the assistant what you want to know about:

  💬  "Summarize my inbox every 5 minutes"
  💬  "Tell me today's events every morning at 8"
  💬  "What changed on the marketing project this week?"

      [ Open chat to set one up ]

──────────────────────────────────────────────────

Or set one up manually  ⌄
  [ + Custom ]
```

## Agent flow

Primary creation path is conversational. The hand-built editor is
the secondary path (essential for editing existing pulses + power
users).

### Tool surface (loaded by the `pulses` skill)

Discovery:
```
pulses.list_spaces_with_recipes()
pulses.list_space_recipes(spaceId)
```

Composition:
```
pulses.propose({ title, schedule, recipe, delivery, model })
  → { previewCard }     // transient — never persisted
```

`propose` returns the card payload for chat UI to render. Nothing
is stored. Clicking *Create* in the card calls `pulses.create(...)`
with the same payload. **No drafts.**

Management:
```
pulses.list()
pulses.get(id)
pulses.update(id, partial)        // mutations go through confirm card
pulses.toggle(id, enabled)
pulses.delete(id)                  // requires confirm
pulses.run_now(id)
```

### Confirmation card

```
┌──────────────────────────────────────────────────┐
│ 📬  Set up Mail summary pulse?                   │
│                                                  │
│  Every 5 minutes I'll check your inbox and       │
│  summarize anything new and important.           │
│                                                  │
│  Schedule:  Every 5 minutes                      │
│  Action:    mail.listThreads(label=INBOX,        │
│             q=is:unread) + summarize             │
│  Notify:    Bell + system notification           │
│  Model:     Cheap (Haiku 4.5) — good for         │
│             summaries.                           │
│  Cost:      ~$0.04 / week  (~12,000 tokens)     │
│                                                  │
│              [ Adjust ]  [ Cancel ]  [ Create ]  │
└──────────────────────────────────────────────────┘
```

Card is **transient** — closing the chat without clicking Create
discards it. No "Drafts" tab anywhere.

### Skill triggers

`pulses` skill auto-loads when language matches: *"every", "daily",
"hourly", "remind me", "tell me when", "let me know if", "watch
for", "each morning"*. Skill prompt teaches:

- Default to **cheap** tier; escalate only with explicit reason.
- Use **two-bucket summary** structure by default.
- Default to **bell + OS notification**; offer to add email/WhatsApp/
  etc. if user mentions a channel.
- **Never create silently** — always propose and let the user confirm.

### Conversations this unlocks

- "What pulses do I have?" → `pulses.list()` → narrate.
- "Why didn't my mail pulse fire this morning?" →
  `pulses.get(mailPulseId)` → reason about `recentErrors`.
- "Stop the project pulse for the week, I'm on vacation." →
  `pulses.toggle(id, false)` + set a reminder to re-enable.
- "Change mail to every 15 minutes." →
  `pulses.update(id, { schedule: { kind: 'interval', everyMinutes: 15 } })`
  via confirmation card.

## Recommendations

Three surfaces, all opt-in / dismissable, all bounded by anti-nag
rules.

### 1. Post-install card

When a space declaring `suggested_pulses` installs:

```
┌──────────────────────────────────────────────────┐
│ ✓ Mail installed                                │
│                                                  │
│ Mail supports pulses — recurring summaries       │
│ that surface what changed.                       │
│                                                  │
│ Recommended for Mail:                            │
│   □ Summarize my inbox every 5 minutes           │
│   □ Morning inbox digest at 8am                  │
│                                                  │
│   [ Set up selected ]  [ Skip ]                  │
└──────────────────────────────────────────────────┘
```

Skip dismisses permanently for this exact recipe.

Space manifest declares:

```json
{
  "suggested_pulses": [
    {
      "title": "Summarize my inbox",
      "schedule": { "kind": "interval", "everyMinutes": 5 },
      "recipe": { ... },
      "rationale": "Catch important emails without constantly checking"
    }
  ]
}
```

### 2. Recommended section on Pulses page

For users who skipped install cards or installed spaces before
pulses existed:

```
RECOMMENDED FOR YOU                              [ ⌄ ]

Based on the spaces you've installed:

  📬  Mail — Morning inbox digest
       Daily at 8am · [ Set up ]  [ Dismiss ]
  📅  Calendar — Today's events
       Daily at 8am · [ Set up ]  [ Dismiss ]
```

Collapsible. Dismissals per-recipe.

### 3. Inline chat suggestion

When user expresses scheduling intent organically, the pulses skill
loads and the agent proposes a pulse.

### Anti-nag rules

- One install-time card per space, never re-shown after dismissal.
- "Recommended" section dismissable per-recipe.
- Inline chat suggestions: max one per turn, only on genuine intent
  match (not casual "every" mentions).
- Global toggle: Settings → Notifications → "Suggest pulses for new
  spaces" (default ON).

---

# Part 3 — Multi-scope discipline

Users belong to multiple scopes — personal + every org they're in.
All scope contexts active simultaneously.

```
Flak's identity → scopes:
  - { kind: 'user', id: flak-user-id }
  - { kind: 'org',  id: acme-org-id }
  - { kind: 'org',  id: sideproject-org-id }
```

Each scope has its **own independent pulse list**. Same Mail space,
three different sets of pulses (personal Gmail, work @acme.com,
client mail at SideProject).

**Devices serve the union of scopes the user has access to.** A
device paired as Flak's automatically subscribes to scheduler tasks
from *every* scope Flak belongs to. No per-device scope binding.

**Recipe execution inherits the pulse's scope** — bridge calls
automatically use the right identity context. Acme-org pulse running
`mail.listThreads` calls Mail with `actingAs(acme)` → returns work
mail, not personal. Same code path, scope is the variable.

**UI vs global view:**

- **Pulses page (in pulses-space)** = current scope only. Sidebar's
  scope switcher controls what's shown. Flipping Personal → Acme
  rebuilds the list for Acme's data.
- **Settings → Automations** = all scopes union, with a `Scope`
  filter chip.

Same scheduler table, two view filters.

**Delivery channels respect scope.** Personal pulse delivering to
WhatsApp uses the user's WhatsApp space credentials; org pulse uses
the org's. Missing destination in the current scope → broken-
reference row in the pulse list.

---

# Part 4 — Org pulses (deferred, but architectured for)

**Out of scope for v1**, but six identity hooks are baked in now so
adding org features later is purely additive — no schema migration.

The hooks:

1. `Pulse.ownerKind` + `Pulse.ownerId` (instead of `userId`).
2. `ScheduledTask.ownerKind` + `ownerId` + `ownerSpace`.
3. `Pulse.source` includes `{ kind: 'org', orgId, templateId }`.
4. Cost ledger records carry `billedTo: { kind, id }`.
5. Brain pulse execution uses scope tokens (not hardcoded user identity).
6. Device registration carries a `scopes[]` array.

v1 always writes `kind: 'user'`. Later phases start writing `'org'`.
No code changes outside the new features.

## Future levels (separate plan doc)

- **Level 1: Org templates.** Admin in oracle-web creates
  `PulseTemplate` rows (`ownerKind: 'org'`) in pulses-space's graph
  schema. Members in the org see them, subscribe → personal pulse
  with `source: { kind: 'org', orgId, templateId }`. Recipe locked,
  schedule + delivery member-editable.
- **Level 2: Org-owned pulses on an org node.** Org pairs its own
  Construct install (`construct pair --as-org`) — same device-pool
  architecture, scope is `{kind: 'org'}` instead of `{kind: 'user'}`.
  Org-scoped pulses run there. Output to shared channels.
- **Level 3: Cross-user aggregating pulses.** "Summarize marketing
  department work each day." Needs cross-user data-sharing semantics
  — its own design conversation.

No oracle-web endpoints needed — admins read/write the graph schema
directly via the graph SDK with `actingAs(orgId)`. No new service.

---

# Part 5 — Always-on box

A Construct install on a dedicated machine (Mac Mini, old laptop,
Raspberry Pi, NAS in a container) that doesn't sleep. **No special
mode** — it's just a regular desktop app on a box that's always on.

Why this works without new code:
- The device-pool architecture already supports it. Scheduler picks
  best device by power + recency + capability; an always-on box wins
  every claim race for tasks it can handle.
- LM Studio installed on the box turns it into a private inference
  server for local-pulse recipes — privacy story without giving up
  reliability.

Why not "headless brain":
- Spaces are IIFE bundles loaded by the frontend. Brain alone can't
  execute space actions. A headless mode would require building a
  JS runtime + DOM-less Vue + faked bridge — a whole new product.
  Better to just run the full app.

Best deployments:
- **Mac Mini** — trivial setup, native macOS, runs LM Studio for
  private inference, ~10W.
- **Old laptop, lid closed** — works on Mac (Amphetamine or `pmset`)
  and Linux (disable lid-sleep).
- **Raspberry Pi 5** — needs Pi OS Desktop (Tauri requires webview),
  ARM64 build of Construct.
- **NAS Docker** — Tauri webview in container is hard; not the target.

We ship a short docs page ("Set up a Construct home node"), not a
new product. Same install, same pairing.

---

# Part 6 — Failure modes

| Condition | Behavior |
|---|---|
| All devices offline + task local-only | `state` shows last status; scheduler queues. First device back online drains. |
| Single device offline, others online | Other devices serve normally; offline device catches up on reconnect (most recent only for recurring; always for one-shot reminders). |
| Step fails (upstream API 500) | Mark error; back off (5m → 15m → 1h → 4h → 24h); after 5 consecutive failures pause + send one "needs attention" notification. |
| Auth expired (token revoked) | Mark `auth_required`; pause pulse; notification with "reconnect <space>" link. |
| Multiple devices online | First to claim wins; others get 409. Winner's report fans out. |
| Network partition mid-run | Local outbox; retry on reconnect; server dedupes on `(task_id, scheduled_for)`. |
| OS suspends mid-execution | Run abandoned, claim TTL expires after 60s, scheduler reissues. |
| User toggles off mid-run | In-flight run completes; future runs skipped. |
| Clock drift on device | Server's `scheduled_for` is authoritative. |
| Local-only pulse, no device with required runtime online | Defer; pulse row shows "Requires LM Studio on this laptop — last attempted 3h ago." |
| Delivery channel space uninstalled | Pulse row marks broken-reference; user replaces or removes channel. |

---

# Part 7 — Out of scope

What we deliberately don't build:

- **Event-driven triggers.** Schedule-only at launch. Add an `event`
  schedule kind later if polling alternatives prove insufficient.
- **Cloud-side execution.** Cloud is connectivity, never executor.
  Brain stays local.
- **Headless brain mode.** Always-on boxes run the full app.
- **OS daemon spawner.** Wake-lock + always-on box covers the
  desktop-closed case; no launchd/systemd/Task Scheduler unit needed.
- **Retention / history layer.** Delivery channel = storage.
- **Per-step model selection.** One model per pulse is enough.
- **Recipe DSL editor.** Custom pulses use guided picker + agent.
- **Drafts.** Confirmation card is transient.
- **Cross-user data aggregation.** Level 3 of org pulses — separate
  plan when there's enough cross-space org-shared data to justify it.

---

# Implementation order

Single shippable feature — not phased MVPs. Recommended build order:

1. **Scheduler in `api/source`** — tables, claim protocol, REST + WS,
   push-wake fan-out. Devices `register/heartbeat` endpoints.
2. **Scheduler SDK composable** (`useScheduler()`) on the host.
3. **Always-on toggle** in Settings → Automations + Tauri commands
   for each OS power assertion.
4. **Settings → Automations** UI (global scheduler view).
5. **pulses-space scaffold** — manifest, graph schema, install as
   built-in.
6. **Runner** — subscribes to scheduler ticks, executes recipes,
   reports state.
7. **Pulses page** — list, editor, scope-aware filtering.
8. **Agent tool surface + `pulses` skill** — `propose`, `create`,
   `list`, `update`, `toggle`, `delete`, `run_now`.
9. **Confirmation card** component in chat.
10. **Reminder recipe shape** + one-shot schedule kind.
11. **Delivery channels** — bell + OS notification + email host
    channels; space-routed channel resolution.
12. **Mutation classification + confirm-per-run** flow.
13. **Recommendations** — post-install card, recommended section,
    inline chat triggers, anti-nag.
14. **Cost display** — per-pulse chip, provider-aware formatting.
15. **Multi-scope discipline pass** — make sure every read/write
    respects current scope, devices register all scopes, runner uses
    pulse's scope.
16. **Tests** — schedule calc, dedupe, failure backoff, claim race,
    deferred replay, scope isolation.

Org features (`PulseTemplate`, admin UI in oracle-web, `--as-org`
pairing) ship as a follow-up plan once v1 is live and we have real
usage shaping the requirements.
