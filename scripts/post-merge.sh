#!/bin/bash
set -e

# Install any new/updated dependencies brought in by the merged task.
npm install

# NOTE: We intentionally do NOT run `drizzle-kit push` here.
# This project applies schema changes via generated migrations that run
# automatically at app boot (server/migrate.ts), guarded by the schema-drift
# check. `drizzle-kit push` is interactive (it prompts, and post-merge stdin is
# closed → EOF → hang/fail) and would bypass the migration log. The workflow
# restart that follows this script boots the app, which applies any pending
# migrations idempotently.
