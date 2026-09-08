# Org Projects — Shared Project Registry

## Problem

Projects are currently local-only — stored as filesystem paths on the user's machine. When a user belongs to an org:
- They can't see what projects other members are working on
- There's no shared project list
- Project settings (spaces, agent config) aren't synced
- New members have to manually add project paths

## Model

```
Project lifecycle:

1. Org admin creates a project in source (name, repo URL, description)
2. All org members see it in their project list
3. Each member clones/links the repo to their local filesystem
4. Project metadata (name, spaces, settings) synced via source
5. Project files stay local — git handles code sync
```

**Two types of projects:**
- **Local projects** — personal, not in source. Current behavior. For users not in an org.
- **Org projects** — registered in source, visible to all org members. Metadata synced.

## Source API

### New model: OrgProject

```sql
org_projects:
  id           VARCHAR(36) PK
  org_id       VARCHAR(36) NOT NULL
  name         VARCHAR(255) NOT NULL
  description  TEXT
  repo_url     VARCHAR(500)     -- git repo URL (for clone)
  default_branch VARCHAR(100)   -- main, master, etc.
  framework    VARCHAR(50)      -- vue, react, flutter, laravel, etc.
  created_by   VARCHAR(36) NOT NULL
  created_at   TIMESTAMP
  updated_at   TIMESTAMP
  UNIQUE(org_id, name)
```

### New endpoints

```
GET    /api/org/projects              — list all org projects
GET    /api/org/projects/{id}         — get project details
POST   /api/org/projects              — create (admin+)
PUT    /api/org/projects/{id}         — update (admin+)
DELETE /api/org/projects/{id}         — delete (admin+)
```

## Frontend Changes

### Project store
- When user is in org: merge local projects + org projects
- Org projects show a badge "Shared" or org icon
- Project detail page: show org metadata + local path (if linked)
- "Link to local folder" button for org projects not yet cloned

### Project list
- Two sections: "Org Projects" (from source) + "Local Projects" (from filesystem)
- Or unified list with "shared" badge

## Priority

This is a follow-up feature. The immediate fix for the ":id" route is just the deleted data dir — projects need to be re-created or the cached sidebar state needs to be cleared.

## Implementation Order

1. Fix the ":id" route display (show proper empty state, not raw `:id`)
2. Add OrgProject model + API to source
3. Update frontend project store to fetch org projects
4. Add "Link to local folder" flow
5. Sync project settings via source
