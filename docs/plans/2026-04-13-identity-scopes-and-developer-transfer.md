# Identity Scopes, Developer Enrollment, and Space Ownership Transfer

**Date:** 2026-04-13
**Status (2026-04-20):** Partial. Scopes (`app`/`project`/`org`/`any`) shipped
— declared in space manifests and enforced in the space loader. Developer
enrollment + space ownership transfer endpoints are not implemented; no
evidence of a transfer flow in the developer portal or `my.construct.space`
client. Split this plan: carve scopes out as done, keep developer-transfer as
the live section and scope it to what's actually next.
**Services touched:** `infra/accounts`, `infra/source`, `infra/developer`, `construct-app` (frontend)

---

## 1. Goals

1. **Isolated identity scopes at login.** A session is *either* personal or org — never mixed.
2. **Developer is additive, not exclusive.** A user can be a regular user *and* a developer; an org admin can also hold the developer role.
3. **Org-gated developer role.** Personal developer is a binary user capability. Org developer is a real role in the org's role catalog, only unlocked when the org enrolls.
4. **Ownership of published spaces is transferable** between identities (personal ↔ org) via a two-sided handshake, App Store-style (clean ownership flip, no residual attribution).

---

## 2. Service responsibilities

| Service | Owns | DB tables touched by this plan |
|---|---|---|
| `infra/accounts` | Identity, credentials, sessions, JWT issuance | `users` (no schema change) |
| `infra/source` | Organizations, memberships, org roles | `organizations`, `org_members`, `org_roles` (new column), `org_member_roles` (existing) |
| `infra/developer` | Publishers, spaces, CLI tokens, ownership transfer | `publishers` (schema change), `spaces` (comment change), `space_transfers` (new) |

Cross-service contract: HTTP, peer-to-peer, called only by `accounts` during login. No event bus required for v1.

---

## 3. Identity scopes

### 3.1 Two scopes, never both

- **`user`** — personal scope. No role system. Optional `developer` capability flag.
- **`org`** — org scope. Org's role catalog applies. `roles[]` is a list of role keys held by the user in *that* org.

A user with personal developer capability *and* membership in an org will resolve to `scope: "org"` at login (org wins). Their personal Publisher row remains in the developer DB but is **dormant** while the org session is active.

### 3.2 Login resolver (in `accounts`)

**Constraint:** A user belongs to **at most one org**. There is no multi-org membership and no org-picker step. Org invitations to a user already in another org must be rejected at the source service (return `409 already_in_org`).

```
POST /login
  1. Verify credentials (password / passkey / TOTP — existing flow).
  2. membership = HTTP GET source/internal/memberships?user_id=<uuid>   // 0 or 1
     - if none:
         is_dev = HTTP GET developer/internal/publishers?user_id=<uuid>&kind=user
         issue JWT { sub, scope: "user", developer: bool(is_dev) }
     - if one:
         org_roles = HTTP GET source/internal/org-roles?org_id=<id>&user_id=<uuid>
         issue JWT { sub, scope: "org", org_id, roles: [...] }
```

JWT shapes:

```json
{ "sub": "user_uuid", "scope": "user" }
{ "sub": "user_uuid", "scope": "user", "developer": true }
{ "sub": "user_uuid", "scope": "org", "org_id": "...", "roles": ["admin"] }
{ "sub": "user_uuid", "scope": "org", "org_id": "...", "roles": ["member", "developer"] }
```

Downstream services trust JWT claims; they do not re-query `source` per request.

### 3.3 Dormancy on org join (warning required)

When a personal-developer user accepts an org invitation to an **unenrolled** org, the join UI must show:

> Joining ACME will pause your personal developer access until you leave or ACME enrolls as a publisher. Your published spaces stay live and continue to receive downloads. You can resume personal developer access by leaving the org.

The personal Publisher row is preserved (not deleted). Already-published spaces remain reachable under their existing slug. Only the user's *active* session capability changes.

If the org later enrolls and assigns the user the Developer role, the user gets `roles: [..., "developer"]` and publishes under the **org's** Publisher (separate namespace from their personal Publisher).

On leaving the org → next login resolves to `scope: "user"`, personal developer capability returns automatically.

---

## 4. Developer enrollment (two paths)

### 4.1 Personal path

```
user → POST developer/api/enroll/personal
     → creates Publisher { UserID = user.uuid, OrgID = nil }
     → user.developer = true (reflected via login resolver, no separate flag table)
```

No role machinery. Capability is derived from `EXISTS (Publisher WHERE UserID = user.uuid)`.

### 4.2 Org path

Only the org's `OwnerID` (single owner from `source.Organization`) may enroll the org as a publisher. Co-owners / admin-role members cannot. Revisit if multi-owner orgs are introduced.

```
1. user joins org                          → OrgMember row in source
2. org owner: POST developer/api/enroll/org { org_id }
                                           → creates Publisher { OrgID = org.id, UserID = nil }
                                           → callback to source: enable "developer" role in org's role catalog
3. org admin: POST source/api/orgs/:id/members/:m/roles { role: "developer" }
                                           → standard role-assignment, no new endpoint
```

The "developer" role only appears as assignable in the org's role-management UI **after** step 2 succeeds. Orgs that haven't enrolled don't see it.

Not all members are developers — assignment is per-member, by admin choice.

---

## 5. Schema changes

### 5.1 `infra/developer` — `publishers` table

Replace the current free-text `Org` field with a proper FK shape:

```go
type Publisher struct {
    ID        uint
    OrgID     *string   // nullable; set => org publisher
    UserID    *string   // nullable; set => personal publisher
    Name      string
    Email     string
    APIKey    string
    Website   *string
    AvatarURL *string
    Verified  bool
    CreatedAt *time.Time
    UpdatedAt *time.Time
    // Invariant: exactly one of OrgID, UserID is non-nil.
}
```

Migration: add `org_id` (string, nullable, indexed), add `user_id` (string, nullable, indexed), backfill from existing `Org` text + email-matched user lookup where possible, drop `Org` after backfill verified.

### 5.2 `infra/source` — `org_roles` catalog

Add a `system` boolean column (default false) so the auto-inserted "developer" role is identifiable and not deletable via the standard role UI.

If `org_roles` doesn't exist as a table yet (only `OrgRole` enum), create it as part of this work — it's required for org-scoped role catalogs and the developer-role unlock.

### 5.3 `infra/developer` — `space_transfers` table (new)

```go
type SpaceTransfer struct {
    ID          uint
    SpaceID     uint       // FK spaces.id
    FromUserID  *string    // owner snapshot at request time
    FromOrgID   *string
    ToUserID    *string
    ToOrgID     *string
    InitiatedBy string     // user uuid that clicked Transfer
    Status      string     // pending | accepted | declined | cancelled | expired
    Message     *string
    CreatedAt   time.Time
    RespondedAt *time.Time
    ExpiresAt   time.Time  // CreatedAt + 14 days
}
```

### 5.4 `infra/developer` — `spaces` table

`Space.OwnerUserID` and `Space.OwnerOrgID` already exist. Edit the comment at `space.go:31` from `// Ownership — immutable after first claim` to `// Ownership — current owner; mutable via SpaceTransfer`. No column changes.

---

## 6. Space ownership transfer

### 6.1 Flow

```
1. Initiator (current owner): Developer portal → Spaces → [space] → Transfer ownership
   - Picks target from list of: orgs they belong to where org is enrolled, OR their personal publisher (for org → personal).
   - Creates SpaceTransfer { status: pending, expires in 14 days }.

2. Target's authorized actor (personal user OR admin of target org):
   Developer portal → Pending transfers
   - Sees inbox of pending requests.
   - Accept | Decline.

3. On Accept (transactional):
   - Verify status=pending, not expired, target Publisher still enrolled.
   - Update Space:
       OwnerUserID, OwnerOrgID = target
       Author, PublisherName, PublisherUserID = new Publisher's values
   - SpaceTransfer.Status = "accepted", RespondedAt = now.
   - Email old + new owner.

4. After transfer:
   - Old owner has zero access (no listing trace, no edit, no publish).
   - New owner's API key signs all future versions.
   - 7-day re-transfer lock (UpdatedAt-based) to prevent ping-pong.
```

### 6.2 Endpoints (`infra/developer`)

```
POST   /api/spaces/:name/transfers      # initiate
GET    /api/transfers/incoming          # target inbox
GET    /api/transfers/outgoing          # initiator outbox
POST   /api/transfers/:id/accept        # target accepts
POST   /api/transfers/:id/decline       # target declines
DELETE /api/transfers/:id               # initiator cancels
```

### 6.3 Authorization

| Endpoint | Allowed caller |
|---|---|
| POST /spaces/:name/transfers | Personal owner of space, OR admin of org that owns space |
| accept/decline | Personal user (if ToUserID = sub), OR admin of org (if ToOrgID = user's org and user has admin role) |
| cancel | InitiatedBy = sub only |

### 6.4 Guardrails

1. **Block transfer if `Space.Status = "submitted"`** (in moderation queue). Reviewer notes attach to the wrong owner otherwise. Finish review first.
2. **7-day re-transfer lock** post-accept.
3. **Target must be an enrolled publisher** at accept time (re-verified, not just at initiation).
4. **No attribution preserved.** Per product decision: clean App Store-style transfer. Author and publisher fields fully overwritten.

### 6.5 Reverse case (org → personal)

Supported by the same flow. Org admin initiates, personal user accepts. Use cases: contributor leaving the org and taking their space with them (with org consent).

---

## 7. Frontend changes (`construct-app`)

### 7.1 Login

- Handle two response shapes from `POST /login`: user, org. No org-picker.
- After login, route based on `scope`:
  - `user` → `/me` (personal profile, isolated).
  - `org` → `/orgs/:id/me` (org member profile, isolated).
- Capability gates: `developer === true` (user scope) or `roles.includes("developer")` (org scope) shows developer panels.

### 7.2 Org join confirmation

New modal before accepting an org invitation that shows the dormancy warning (§3.3) when the joining user is currently a personal developer and the target org is not enrolled as a publisher.

### 7.3 Developer portal

- New route: `/developer/spaces/:name/transfer` — initiate form.
- New route: `/developer/transfers` — split view: incoming (accept/decline) + outgoing (cancel).
- Org admin variant of `/developer/transfers` for org-owned spaces (visible to admin role).

### 7.4 Org role management

Surface the auto-added "Developer" role in the role-assignment UI once the org enrolls. Mark `is_builtin = true` roles as undeletable. No visual distinction otherwise.

---

## 8. Reconciliation with `plan-roles-permissions.md`

Aligning with the existing roles plan (`docs/plan-roles-permissions.md`) so they stop conflicting:

- **Use the existing schema.** This plan reuses `org_roles` and `org_role_permissions` exactly as defined in the roles plan. The `is_builtin` boolean is the seed/lifecycle marker — no new `system` column.
- **Drop "Developer" from the always-seeded built-ins list** in the roles plan. The default seed becomes: Owner, Admin, PM, Member.
- **Developer is conditionally seeded.** Inserted into `org_roles` with `is_builtin = true` only when the org's owner enrolls the org as publisher (§4.2). Removed (or marked inactive) if the org un-enrolls.
- **Default Developer permissions** seeded with the role:
  ```
  spaces.architect.access
  spaces.coder.access
  spaces.editor.access
  spaces.deployment.access
  spaces.development.access
  developer.publish        — publish/update spaces under org publisher
  developer.transfer       — initiate ownership transfer requests
  developer.cli            — generate CLI tokens scoped to org
  ```
  Admins can edit this set after seeding (built-in by lifecycle, not by lockdown).
- **JWT carries `roles[]` only.** Compact and stable. Frontend/middleware resolves roles → permissions on demand using the roles plan's lookup. Re-fetched on app startup (§9).

`plan-roles-permissions.md` requires one edit: remove "Developer" from the built-ins table (line 82), add a note that Developer is conditionally seeded by the developer-enrollment flow defined in this plan.

---

## 9. CLI / SDK / Graph integration

### 9.1 `packages/construct-cli`

| File | Change |
|---|---|
| `src/commands/login.ts` | Handle two response shapes from `accounts/login` (user, org). No picker. Persist `scope`, `org_id`, `roles[]` in CLI session file. |
| `src/commands/publish.ts` | Read scope from session. Personal scope → publish under personal Publisher. Org scope → publish under org Publisher (require `developer.publish` in `roles[]`'s resolved permissions, else error with clear message). |
| `src/commands/graph/init.ts` | Scope new schema to current identity (`user_id` or `org_id`). |
| `src/commands/graph/push.ts`, `migrate.ts`, `generate.ts` | Pass scope to `infra/graph` so schema operations target the right namespace. |
| `src/lib/session.ts` (or equivalent) | Add scope fields. On startup, re-resolve scope by hitting `accounts/me` if token is older than N hours (mirrors app-startup resolution). |

### 9.2 `packages/graph` (SDK)

| File | Change |
|---|---|
| `src/composable.ts` (`useGraph`) | Read scope from injected JWT context. Auto-scope all reads/writes by `(scope, owner_id)`. Personal queries never see org data; org queries never see other-org or personal data. |
| `src/define.ts` | No code change. Document that models defined in an org context are namespaced under that org. |
| `src/index.ts` | Re-export a `setScope(jwt)` initializer for non-Vue consumers (CLI uses this). |

### 9.3 `infra/graph`

| File | Change |
|---|---|
| `internal/auth/auth.go` | Parse new JWT claims (`scope`, `org_id`, `roles`). Reject requests where the requested resource's scope doesn't match the token's. |
| `internal/auth/oauth.go` | Re-resolve scope from accounts on token refresh. |
| `internal/schema/registry.go` | Partition schemas by `(scope, owner_id)`. Composite uniqueness: `(scope, owner_id, schema_name)`. Query helpers must take a scope filter — never global. |
| `internal/schema/admin.go` | Org admins can only manage their own org's schemas. Personal users only their own. Construct super-admin can see all (separate flag). |
| `internal/graphql/*` | Inject scope into resolver context; gate field-level access by `roles[]` where relevant. |
| `internal/realtime/*` | Subscriptions filtered by scope at subscribe time, not at publish time (prevents leakage). |

### 9.4 Cross-cutting

- **Migration**: existing graph data (pre-scope) gets backfilled into a default scope (assume personal-by-user_id where derivable, else flagged for manual review).
- **Tests**: cross-scope leakage tests are mandatory — write a personal record, log in as org user, verify zero visibility (and vice versa).

---

## 10. Implementation order

Status key: ✅ shipped · 🟡 partial · ⏳ pending

1. ✅ **`accounts` login resolver** — implemented as `GET /api/me/scope` (cookie-session based, not JWT claims — accounts uses opaque sessions). Returns `{ user, scope, org?, roles?, developer? }`. Peer services called via shared `X-Internal-Secret` header.
2. ✅ **`source` memberships endpoint** — `GET /internal/membership`. Reuses existing `org_roles` table.
3. ✅ **`source` invitation guard** — 409 `already_in_org` (upgraded from pre-existing 400).
4. 🟡 **`developer` Publisher schema** — `UserID`/`OrgID` columns added and indexed; legacy `Org` text column retained during migration. Auto-link on `/api/enroll/personal` for the common case; one-shot backfill endpoint `/internal/publishers/backfill` paired with `accounts/internal/users/developer-candidates` covers the long tail. Drop of `Org` + accounts `developer_status` column deferred to a manual SQL step.
5. ✅ **`developer` enroll endpoints** — `POST /api/enroll/personal` and `POST /api/enroll/org`; org enroll verifies ownership via `source/internal/org/owned` and seeds the Developer role via `source/internal/developer-role/seed`.
6. ✅ **`infra/graph` scope-aware auth** — consumes `/api/me/scope`, propagates `X-Auth-Scope`, `X-Auth-Org-ID`, `X-Auth-Org-Slug`, `X-Auth-Roles`. GraphQL handler now uses the trusted `X-Auth-Org-ID` for company-scoped schema resolution instead of the client-supplied `X-Company-ID` (security fix). Resolver-level partitioning (schemas, subscriptions) uses existing per-schema isolation.
7. ⏳ **`packages/graph` SDK scope wiring** — SDK uses backend-issued tokens which already carry scope via graph's auth layer. Explicit `setScope()` deferred unless a consumer needs it.
8. 🟡 **`packages/construct-cli`** — `login` shows publisher kind (user/org/legacy) from `cli-verify`. `publish` and graph commands unchanged; the backend resolves publisher by CLI token so no client-side scope passing is required today.
9. ✅ **`construct-app` login flow** — `authStore.refreshScope()` action + `isDeveloper` / `isOrgAdmin` getters; `useDevMode` migrated to scope getter + developer-service enrollment.
10. ✅ **Org-join dormancy modal** — `DormancyWarning.vue` gated by `getInviteInfo` preview; wired into `OrganizationSettings` join form.
11. ✅ **`developer` `space_transfers` table + 6 endpoints** — pending/accepted/declined/cancelled/expired handshake, 14-day expiry, 7-day re-transfer lock, App Store-style ownership flip.
12. ✅ **Developer portal transfer UI** — `/author/transfers` (inbox/outbox) + initiate form on `SpaceDetailPage`.
13. ✅ **Org admin transfer inbox** — same page; inbox query includes org-targeted transfers when caller holds owner/admin role in their org.
14. ⏳ **Cross-scope leakage test suite** — not implemented; recommended follow-up.

Steps 1–10 landed as the identity foundation. 11–13 landed as the transfer feature. 7, 8 (remaining), 14 remain as polish / hardening.

---

## 11. Decisions

- **Flat slugs (no namespace) for v1.** `Space.Name` stays globally unique. On transfer, the slug does not change — only `OwnerUserID`/`OwnerOrgID`, `Author`, and `PublisherName` flip. URLs survive transfer unchanged. Namespacing (GitHub-style `owner/name`) deferred to a future revision when slug collisions become a real problem.

- **Slug reuse after transfer requires rename.** Once `kanban-pro` is transferred from Jane to ACME, Jane cannot create a new `kanban-pro` — she must pick a different slug (`kanban-pro-2`, etc.). The flat-unique constraint enforces this automatically; the create/publish UI should surface a clear "slug taken" error with a suggested alternative.

- **Org deletion does not cascade-delete spaces.** When an org is deleted in `source`, its owned spaces are **archived and transferred to a system "construct" publisher**, not deleted (NPM-style: published artifacts that other users depend on must persist).
  - On org delete: enumerate spaces with `OwnerOrgID = <id>`, set `Status = "archived"`, reassign `OwnerOrgID = <construct_system_org_id>`.
  - Construct admin reviews archived spaces in an admin panel: sees install count and dependents, decides per-space whether to unarchive under construct ownership, mark deprecated, or hard-delete (only if zero installs).
  - Implies a seeded "construct" Organization + Publisher row, plus an admin-only review queue. Out of scope for v1 implementation steps but the archival path itself ships in v1 so org deletion doesn't orphan rows.

- **JWT re-resolution on app startup.** Long-lived access tokens; scope/roles re-fetched from `source` + `developer` each time the app launches (cold start). No per-request re-check, no short TTL. Mid-session role changes take effect on next app open. Simple, low load on `source`.

- **CLI tokens left alone on transfer.** Old owner's tokens remain valid for their other spaces. Publish attempts to the transferred space will fail authorization at the publisher check. No auto-revocation.

- **Email service.** Transfer notifications use ConstructDelivery. Templates owned by the developer service.

---

## 12. Out of scope (v1)

- Multi-org membership / org switching (one user = at most one org, enforced at invite time).
- Org-to-org direct transfer (must go through accept/decline like any other).
- Bulk transfer of multiple spaces in one request.
- Original-author attribution preservation (explicitly rejected — App Store model).
- Personal + org *coexistent* scopes via a session switcher (rejected — isolation rule).
