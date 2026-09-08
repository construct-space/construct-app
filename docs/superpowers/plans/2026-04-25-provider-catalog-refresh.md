# Provider Catalog Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a header Refresh button for LLM Providers and make `providers.json` the only local persisted provider catalog cache.

**Architecture:** The remote source catalog remains the global source of truth. The frontend keeps only an in-memory reactive catalog, pushes fetched raw catalog to the operator via existing `modelspec.load`, and the operator persists it to `providers.json`. The Providers page owns the visible Refresh button and delegates forced refresh to `LLMProvidersPanel`.

**Tech Stack:** Vue 3, Vitest, Tauri operator IPC, Go operator existing `modelspec.load` cache path.

---

### Task 1: Remove frontend durable provider catalog cache

**Files:**
- Modify: `frontend/composables/useProviderCatalog.ts`
- Test: `frontend/composables/useProviderCatalog.test.ts`

- [ ] Write tests proving catalog load does not read/write `localStorage` and still pushes successful fetches to `modelspec.load`.
- [ ] Run the test and verify it fails because current code uses `localStorage`.
- [ ] Remove `loadFromStorage`, `saveToStorage`, and localStorage hydration from `useProviderCatalog.ts`.
- [ ] Run the test and verify it passes.

### Task 2: Read local catalog from operator providers.json

**Files:**
- Modify: `operator/internal/provider/bootstrap/catalog.go`
- Modify: `operator/internal/ai/module.go`
- Modify: `frontend/composables/useProviderCatalog.ts`
- Test: `operator/internal/provider/bootstrap/catalog_test.go`
- Test: `frontend/composables/useProviderCatalog.test.ts`

- [ ] Add `ReadCatalogFromDisk()` for `providers.json`.
- [ ] Add `modelspec.catalog.get` IPC handler returning cached catalog JSON.
- [ ] Hydrate frontend in-memory catalog from `modelspec.catalog.get` before remote fetch when empty.
- [ ] Run frontend and operator tests.

### Task 3: Add Refresh button with spinning icon

**Files:**
- Modify: `frontend/pages/settings/LLMProviders.vue`
- Modify: `frontend/components/settings/LLMProvidersPanel.vue`

- [ ] Expose `refresh()` and `refreshing` from `LLMProvidersPanel.vue`; `refresh()` calls `catalog.load(true)` and `loadConfigured()`.
- [ ] Add a right-side header button in `LLMProviders.vue` labelled `Refresh`.
- [ ] Show a spinning refresh icon only while refresh is running; disable button while refreshing.
- [ ] Run frontend tests/typecheck for verification.
