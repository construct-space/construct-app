# Plan: Custom Roles & Permissions System

## Problem

Current system has 4 hardcoded roles (owner/admin/manager/member) with permissions baked into handler if-statements. This doesn't support:
- Custom roles like "Developer", "PM", "Designer"
- Per-space access control (Developer sees Coder, PM sees Kanban)
- Project-level assignments (PM creates projects, assigns developers)
- Granular permissions that evolve as new spaces ship

## Design

### Core Concept: Permissions are atomic, Roles are bags of permissions

```
Permission: "projects.create"
Permission: "projects.assign_members"
Permission: "spaces.coder.access"
Permission: "spaces.kanban.admin"
Permission: "members.invite"

Role "Developer" = [
  "spaces.coder.access",
  "spaces.editor.access",
  "spaces.architect.access",
  "projects.view",
  "projects.code",
]

Role "PM" = [
  "projects.create",
  "projects.assign_members",
  "projects.view",
  "spaces.kanban.admin",
  "spaces.org-project.access",
  "members.view",
]

Role "Designer" = [
  "spaces.design.access",
  "projects.view",
]
```

### Permission Namespace Convention

```
{resource}.{action}

Resources:
  org              — organization settings
  members          — member management
  roles            — role management
  departments      — department management
  projects         — org projects
  providers        — AI provider keys
  mcp              — MCP servers
  skills           — skills management
  hooks            — hooks management
  activity         — activity log
  insights         — org insights/analytics
  spaces.{id}      — per-space access (spaces.coder, spaces.kanban)

Actions:
  view             — read access
  create           — create new
  edit             — modify existing
  delete           — remove
  admin            — full control of resource
  access           — can open/use (for spaces)
  assign_members   — assign people to resource
  code             — can write code in project
```

### Built-in Roles (non-deletable, editable permissions)

| Role | Description | Key Permissions | Seeded |
|------|-------------|----------------|--------|
| Owner | Full control, transfer ownership | `*` (all) | On org create |
| Admin | Manage org, members, settings | All except `org.delete`, `org.transfer` | On org create |
| PM | Project management | `projects.*`, `members.view`, `spaces.kanban.admin` | On org create |
| Member | Basic access | `projects.view`, `spaces.*.view` | On org create |
| Developer | Code, build, publish org spaces | `spaces.architect.access`, `spaces.coder.access`, `spaces.editor.access`, `spaces.deployment.access`, `spaces.development.access`, `developer.publish`, `developer.transfer`, `developer.cli` | **Conditionally** — only when org owner enrolls org as publisher (see `plans/2026-04-13-identity-scopes-and-developer-transfer.md` §4.2) |

### Custom Roles

Admins can:
- Create new roles with a name + description
- Assign permissions from the full list
- Assign role to members
- Delete custom roles (reassigns members to "Member")

### Database Schema

```sql
-- Role definitions (per org)
CREATE TABLE org_roles (
  id          VARCHAR(36) PRIMARY KEY,
  org_id      VARCHAR(36) NOT NULL,
  name        VARCHAR(100) NOT NULL,
  description TEXT,
  is_builtin  BOOLEAN DEFAULT FALSE,  -- owner/admin/pm/developer/member
  created_at  TIMESTAMP,
  updated_at  TIMESTAMP,
  UNIQUE(org_id, name)
);

-- Permissions assigned to a role
CREATE TABLE org_role_permissions (
  id          VARCHAR(36) PRIMARY KEY,
  role_id     VARCHAR(36) NOT NULL,
  permission  VARCHAR(200) NOT NULL,  -- e.g. "spaces.coder.access"
  UNIQUE(role_id, permission)
);

-- Members get a role_id instead of role string
-- ALTER TABLE org_members ADD COLUMN role_id VARCHAR(36);
-- Eventually drop the role VARCHAR column
```

### Migration Path

1. Keep existing `role` string field on OrgMember for now
2. Add `org_roles` and `org_role_permissions` tables
3. Seed built-in roles on org creation (owner, admin, pm, developer, member)
4. Map existing role strings to role IDs
5. Handlers check permissions via role_id → permissions lookup instead of `caller.Role != "admin"`

### API Endpoints

```
GET    /api/org/roles                    — list all roles for org
GET    /api/org/roles/{id}               — get role with permissions
POST   /api/org/roles                    — create custom role (admin+)
PUT    /api/org/roles/{id}               — update role name/description/permissions (admin+)
DELETE /api/org/roles/{id}               — delete custom role (admin+, not builtin)
GET    /api/org/permissions              — list all available permissions
PUT    /api/org/members/{id}/role        — assign role to member (admin+)
```

### Frontend

**Settings > Organization > Roles page:**
- Permission matrix table (current static page becomes dynamic)
- Create custom role button
- Edit role → toggle permissions checkboxes
- Built-in roles: permissions editable but role can't be deleted
- Custom roles: fully editable, deletable

**Member assignment:**
- Member detail / edit → role dropdown shows all org roles
- Members list → role badge links to role

**Space access enforcement:**
- Sidebar filters spaces based on member's role permissions
- `spaces.{id}.access` permission gates space visibility
- Space-level admin (`spaces.{id}.admin`) enables space-specific settings

### Enforcement Points

```
Frontend (visibility):
  Sidebar3D.vue        — filter spaces by permissions
  SettingsRouter.vue    — show/hide settings sections
  OrgMembers.vue        — show/hide admin actions

Backend (authorization):
  org.go handlers       — check permission instead of role string
  middleware             — inject permissions into request context

Helper:
  func hasPermission(member *OrgMember, perm string) bool {
    // Load role → permissions from cache/DB
    // Check if perm is in the set
    // Support wildcard: "projects.*" matches "projects.create"
  }
```

### Space Registration

When a new space is published/installed, it declares required permissions in its manifest:

```json
{
  "id": "kanban",
  "permissions": {
    "access": "spaces.kanban.access",
    "admin": "spaces.kanban.admin"
  }
}
```

The org admin assigns these permissions to roles. New spaces automatically create permission entries that admins can then assign.

### Implementation Order

1. **Database**: Add `org_roles` + `org_role_permissions` tables
2. **Seed**: Create built-in roles on org creation
3. **API**: CRUD for roles + permissions list
4. **Migration**: Map existing `role` strings → `role_id`
5. **Backend enforcement**: Replace inline role checks with permission checks
6. **Frontend Roles page**: Dynamic matrix with edit capability
7. **Frontend enforcement**: Sidebar space filtering, settings visibility
8. **Space manifest**: Permission declaration support

### Future Extensions

- **Project-level roles**: Override org role per project (Developer in org, Admin in specific project)
- **Permission inheritance**: PM inherits all Member permissions
- **Temporary roles**: Time-limited access (contractor for 30 days)
- **Audit log**: Track permission changes
- **API scopes**: Map permissions to API token scopes for CLI/integrations
