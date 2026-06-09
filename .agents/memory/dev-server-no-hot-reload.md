---
name: Dev server does not hot-reload backend code
description: Why server/ changes need a manual workflow restart before API smoke tests
---

The "Start application" workflow runs `tsx server/index.ts` (NOT `tsx watch`).
Vite HMR only reloads the **client** (`client/src/**`). Any change under
`server/**` (routes, storage, services) keeps running the OLD compiled code
until the workflow is restarted.

**Why:** A `/api/users` pagination change appeared to "not work" (returned the
old bare array) purely because the server was still on pre-edit code.

**How to apply:** After editing any `server/**` file, call
`restart_workflow("Start application")` BEFORE curl/API smoke tests, or you'll
debug a ghost. Client-only edits do not need a restart.

Auth for smoke tests is JWT, not session cookies: POST
`/api/auth/login` with the seeded admin (`admin@ahavamedical.com` /
`admin123`) returns `{ token }`; send it as `Authorization: Bearer <token>`.
