---
id: builder-backend
name: Backend Development
description: Build or modify APIs, services, auth, jobs, queues, persistence boundaries, server config, webhooks, or CLI/server-side behavior
trigger: "backend,api,server,service,auth,webhook,queue,job,worker,database,endpoint,rest,graphql,grpc,cli,config"
category: construct
---

# Backend Development

Backend work is contract work. Know the route, payload, storage, auth, and failure behavior before editing.

## Map the Boundary

- Entry point: route, command, job, webhook, or scheduled task.
- Input: params, body, headers, env vars, files, permissions.
- Output: response shape, status codes, side effects, logs, events.
- Persistence: tables/collections/files touched, transactions, cascades, cache invalidation.
- Callers: frontend, CLI, external service, cron, tests.

## Implementation Rules

- Follow the existing framework and folder shape. Do not create a new architecture for one endpoint.
- Validate external input at the boundary.
- Keep auth/permission checks close to the boundary unless the repo has a shared policy layer.
- Make mutations transactional or explicitly idempotent where retries/webhooks/jobs are possible.
- Do not swallow errors. Return useful status codes and preserve enough context for logs.
- Never build shell commands or SQL with unchecked string interpolation.

## Verification

- Run the native compile/type/lint/test commands the repo already uses.
- Exercise the boundary directly: `curl`, CLI command, job runner, or focused unit/integration test.
- Probe at least one failure path: missing auth, invalid input, empty result, duplicate request, downstream error.
- If persistence changed, verify read-after-write and deletion/cascade behavior.
