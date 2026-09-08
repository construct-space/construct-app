# Org-Managed Settings & Provider Isolation

> **Status (2026-04-20):** Partial. Frontend has `orgStore.managedSettings`
> reads (`LLMSettings.vue`, `orgPreferences.ts`). Unclear whether the operator
> enforces managed overrides at the provider boundary or only on the UI side.
> Before resuming: verify server-side enforcement (deny a call that bypasses
> the UI), document which settings keys are managed, and write a test that
> proves a disallowed member-OAuth is actually rejected by the operator.

## The Problem

Settings, credentials, and permissions are currently per-user with no org awareness. When a user belongs to an org:
- They should use org-provided API keys (set by admin), not bring their own
- Org permissions should control what they can do
- Provider auth should be profile-isolated (no OpenCode token leaks)
- Settings should split into org-managed vs local preferences

## The Model

```
Settings hierarchy (highest priority wins):

  Org policy (set by org owner/admin — enforced on all members)
    ├── Provider keys (Anthropic, OpenAI, etc.)
    ├── Default model
    ├── Permissions (what members can do)
    ├── MCP servers (shared)
    ├── Skills (shared)
    └── Billing limits

  User profile (personal, stored locally)
    ├── Theme, appearance
    ├── Editor preferences
    ├── Keyboard shortcuts
    ├── Personal OAuth logins (override org keys if allowed)
    └── Privacy/telemetry consent

  Not a settings source (removed):
    ├── OpenCode auto-discovery
    └── OAuth env vars (ANTHROPIC_OAUTH_TOKEN, etc.)
```

## Settings Page Redesign

### Current (flat)
```
Account: Profile, Privacy
General: General, Appearance, Organization, Developer
AI: LLMs & Models, Media & AI, MCP Servers, Skills & Hooks, Insights
```

### Proposed (org-aware)
```
Account: Profile, Privacy

Workspace (org-managed if in org, local otherwise):
  Providers       — API keys + OAuth connections
  Models          — default model, enabled/disabled models
  MCP Servers     — shared server configs
  Skills & Hooks  — shared skills
  Permissions     — what members can do (admin only)
  Billing         — usage limits, cost tracking (admin only)

Local:
  Appearance      — theme, font, density
  Editor          — keybindings, formatting
  Developer       — CLI, projects directory, space runner

Organization:
  Members         — (admin: manage, member: view)
  Departments     — (admin only)
  Teams           — (admin only)
  Invitations     — (admin only)
  Activity        — audit log
```

When user is NOT in an org: "Workspace" section shows personal settings.
When user IS in an org: "Workspace" section shows org settings (read-only for members, editable for admin/owner).

## Provider Credential Flow

### Without org
```
User opens Settings > Providers
  → Clicks "Login with Claude" → OAuth flow → token saved to profile/providers/auth.json
  → Enters DeepSeek API key → saved to source.construct.space/api/providers/keys
  → All credentials are personal
```

### With org
```
Org admin opens Settings > Providers
  → Sets Anthropic API key → saved to source.construct.space/api/org/providers
  → Sets OpenAI API key → saved to source.construct.space/api/org/providers
  → These apply to ALL org members

Org member opens Settings > Providers
  → Sees org-provided keys (read-only, "Managed by org" badge)
  → Can add personal OAuth login IF org allows personal overrides
  → Personal keys override org keys for that user only
```

### Bootstrap priority (operator)
```
1. Personal OAuth (profile/providers/auth.json) — highest, user explicitly logged in
2. Org provider keys (source.construct.space/api/org/providers) — shared by admin
3. Personal API keys (source.construct.space/api/providers/keys) — user's own keys
4. Env vars (DEEPSEEK_API_KEY, etc.) — dev only, lowest priority
5. REMOVED: OpenCode auto-discovery
6. REMOVED: ANTHROPIC_OAUTH_TOKEN env var
```

## Source API Changes

### New endpoints for org provider management
```
GET    /api/org/providers          — list org-level provider keys
PUT    /api/org/providers/{id}     — set org provider key (admin only)
DELETE /api/org/providers/{id}     — remove org provider key (admin only)
```

### New model: OrgProviderKey
```sql
org_provider_keys:
  id          VARCHAR(36) PK
  org_id      VARCHAR(36) NOT NULL
  provider    VARCHAR(50) NOT NULL  -- 'anthropic', 'openai', 'deepseek', etc.
  api_key     VARCHAR(500) NOT NULL -- encrypted at rest
  set_by      VARCHAR(36) NOT NULL  -- member who set it
  created_at  TIMESTAMP
  updated_at  TIMESTAMP
  UNIQUE(org_id, provider)
```

## Org Permissions Model

### Permission categories
```
providers:
  can_add_personal_keys    — member can add their own API keys (default: true)
  can_use_org_keys         — member can use org-provided keys (default: true)

ai:
  allowed_models           — list of model IDs members can use (empty = all)
  max_tokens_per_day       — daily token limit per member (0 = unlimited)
  can_use_tools            — can agents use tools (default: true)

spaces:
  can_install_spaces       — from marketplace (default: true)
  can_develop_spaces       — developer mode (default: false)

projects:
  can_create_projects      — (default: true)
  can_delete_projects      — (default: false, admin only)
```

### Storage
```
org_settings:
  id       VARCHAR(36) PK
  org_id   VARCHAR(36) NOT NULL
  key      VARCHAR(100) NOT NULL
  value    TEXT
  UNIQUE(org_id, key)
```

## Operator Changes

### Remove OpenCode auto-discovery
- Delete `NewAnthropicOAuthFromOpenCode()` usage from bootstrap
- Remove `AllowOpenCodeAutoLoad` config field
- Remove `ANTHROPIC_OAUTH_TOKEN` / `ANTHROPIC_OAUTH_REFRESH` env var handling

### Add org credential loading
- On bootstrap, if user belongs to org: fetch org provider keys from source API
- Merge with personal credentials (personal overrides org)
- Re-bootstrap on profile switch (clear all in-memory providers)

### ConnectedProviderEntries fix
- "Connected" only when stored credentials exist in profile or org
- Never from runtime provider presence in memory

## Frontend Changes

### Settings page
- Split into Workspace (org-managed) / Local (personal) / Organization (org admin)
- Workspace section: read-only badges for org-managed settings
- Providers tab: show "Managed by [OrgName]" for org keys

### Provider auth
- Remove OpenCode-based provider detection
- Claude login uses Construct's own OAuth flow (not OpenCode's client ID)

## Implementation Order

1. **Provider isolation** — remove OpenCode, fix ConnectedProviderEntries, profile-scoped only
2. **Org provider keys** — source API endpoints + model
3. **Operator org loading** — bootstrap fetches org keys, merges with personal
4. **Settings redesign** — split into workspace/local/org sections
5. **Permissions** — org_settings table, permission checks in operator + frontend
6. **Billing/limits** — token limits, cost tracking per org member
