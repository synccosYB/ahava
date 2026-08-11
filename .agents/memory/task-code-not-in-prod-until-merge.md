---
name: Task code is not in production until merge
description: Why asking the user to publish mid-task can never run new task-branch code in production
---

Task agents work on an isolated branch; the user's Publish builds from the
main workspace code. Any boot-time hook, migration, or script added during a
task does NOT exist in a published deployment until the task is marked
complete and merged.

**Why:** During the prod data wipe work, two publishes ran the OLD server
build and the wipe hook never fired — the env flag and trigger file were
fine; the code simply wasn't in the deployed bundle.

**How to apply:** If a task needs new code to execute in production (one-shot
boot hooks, prod maintenance), finish + merge the task FIRST, then have the
user publish, and hand verification to a follow-up. Never loop on
"publish again" mid-task.

Related: prod DB is read-only from the workspace; one-shot prod actions run
at deployment boot, guarded by a marker tag in `_migration_log` plus a
trigger (env flag WIPE_PROD_DATA and/or committed WIPE_PROD_DATA.trigger file
honored only when REPLIT_DEPLOYMENT is set). Backup+verify must precede any
destructive step and abort on failure.
