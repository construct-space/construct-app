# Org Project Space Design

Date: 2026-04-08

## Problem

Projects are currently local-only — folders on disk in `ConstructProjects/`. There's no way for org members to see shared projects, track status, or coordinate work. The existing `/api/org/projects` endpoints exist but have no frontend space.

## Design

New built-in space `org-project` with `scope: "org"`. Only visible when user belongs to an org. Calls existing `/api/org/projects` CRUD endpoints with extended fields. Users clone or link local folders to org projects for Coder/Editor work.

## Org Project Model

```
OrgProject {
  id            string
  name          string
  description   string
  status        string     // "active", "archived", "planning"
  repo_url      string     // git clone URL
  tags          []string   // e.g., ["frontend", "mobile", "v2"]
  members       []string   // user IDs assigned to this project
  created_by    string
  created_at    timestamp
  updated_at    timestamp
}
```

New fields over current API: `repo_url`, `tags`, `members`.

## Pages

### List (OrgProjectsPage)
- Grid of project cards with name, description, status badge, tags, member avatars
- Search by name/description
- Filter by status, tag, assigned member
- "New Project" button (any org member can create)
- Client-side filtering (org project lists are small)

### Detail (OrgProjectDetailPage)
- Project name, description, status, repo URL
- Assigned members list with add/remove
- Tags with add/remove
- Local link status: "Not linked", "Linked: ~/ConstructProjects/my-app"
- Actions: Clone, Link Existing Folder, Unlink, Open Coder, Open Editor, Archive

## Local Link System

### Clone
1. User clicks "Clone" on org project detail
2. App runs `git clone <repo_url>` into `ConstructProjects/<project-name>/`
3. Creates local project entry linked to the org project ID
4. Writes `.construct/project.json` with `orgProjectId` and `orgId`

### Link Existing
1. User clicks "Link Folder" on org project detail
2. File picker opens → user selects existing local clone
3. Local project linked to org project ID
4. `.construct/project.json` updated

### Unlink
- User can disconnect local folder from org project
- Local project stays, loses org association
- `.construct/project.json` cleared

### Local Project Config
```json
{
  "orgProjectId": "proj_abc123",
  "orgId": "org_xyz"
}
```

When a linked local project opens in Coder/Editor, the org project badge shows in the breadcrumb.

## Permissions

- Any org member can create org projects
- Any org member can edit projects they created or are assigned to
- Admins can edit/delete any project
- Clone/link is local — no permission check needed

## Space Structure

```
frontend/spaces/org-project/
  manifest.json
  pages/
    OrgProjectsPage.vue
    OrgProjectDetailPage.vue
  composables/
    useOrgProjects.ts
  components/
    OrgProjectCard.vue
    CloneLinkModal.vue
    MemberPicker.vue
```

## Infra Changes

In `/Users/flakerim/Construct/infra/source/`:
- Update `internal/models/org.go` — add `RepoURL`, `Tags`, `Members` to OrgProject struct
- Update `internal/handlers/org.go` — handle new fields in create/update handlers
- No new endpoints — existing CRUD is sufficient

## Manifest

```json
{
  "id": "org-project",
  "name": "Projects",
  "scope": "org",
  "icon": "lucide:folder-kanban",
  "navigation": {
    "label": "Projects",
    "icon": "lucide:folder-kanban",
    "to": "org-project",
    "order": 25
  },
  "pages": [
    { "path": "", "label": "Projects", "default": true },
    { "path": "/:projectId", "label": "Project" }
  ]
}
```

## What This Does NOT Include

- No agent — this is a data/management space
- No widgets (can be added later)
- No real-time sync between org members
- No git operations beyond clone (push/pull is in Coder/Editor)
