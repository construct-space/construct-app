---
id: builder-app
name: App Development
description: Build or modify full-stack app features that cross UI, routes, state, API, persistence, permissions, or multi-step user workflows
trigger: "app,full-stack,feature,user flow,workflow,crud,state,route,form,settings,profile,checkout,onboarding,permissions"
category: construct
---

# App Development

App features fail at the joins: UI state, API contracts, persistence, permissions, and navigation. Treat the feature as a user workflow, not a pile of files.

## Feature Map

Before editing, name:

- User flow: entry screen, action, success state, failure state.
- Data model: fields, ownership, defaults, validation, empty state.
- Boundary: frontend state/store, API route, DB/file persistence.
- Permissions: who can view/change/delete.
- Refresh behavior: what updates after create/edit/delete.

## Implementation Rules

- Prefer existing patterns for forms, stores, API clients, routes, modals, notifications, and errors.
- Implement all expected states: loading, empty, populated, validation error, network/server error.
- Mutation order matters: persist first, then update local UI state.
- Make repeated actions safe: double-click submit, retry, back button, refresh.
- Keep copy concrete and action-oriented. Do not add visible instructions for obvious UI.

## Verification

Run baseline checks, then exercise a real workflow:

1. Open the screen.
2. Perform the main action.
3. Confirm persisted/read-back state.
4. Exercise one failure/empty path.
5. Confirm navigation away/back still shows correct state.
