---
name: Post-login auth state handoff
description: Why login success must hard-reload instead of queryClient.clear()+setQueryData
---

# Post-login auth state must use a clean reload, not clear()+setQueryData

After a successful login, do NOT pair `queryClient.clear()` with
`queryClient.setQueryData(["/api/auth/user"], userData)` to establish the
authenticated state. Store the token, drop caches, then `window.location.assign("/")`
for a clean re-bootstrap.

**Why:** `queryClient.clear()` triggers a competing background refetch of the
mounted `/api/auth/user` observer. In contexts where the session cookie is
unreliable (preview iframe, mobile, top-level domain access), that refetch can
land a 401 *after* `setQueryData` ran and overwrite the authenticated user with
null — bouncing every user straight back to the login screen even though
`POST /api/auth/login` returned 200 and a valid JWT was stored. This caused a
total "no one can log in" outage. The token and bearer interceptor were proven
working (manual GET /api/auth/user returned 200); the failure was purely the
React Query state race.

**How to apply:** Auth depends on a bearer token in localStorage attached by the
global fetch interceptor (installed at startup in main.tsx). A full reload re-runs
the auth check exactly once, cleanly, with the stored token, and still routes
through forcePasswordChange correctly. Prefer this deterministic reload for
login; reserve in-memory setQueryData handoffs for flows that don't also wipe the
cache (e.g. change-password uses invalidateQueries with no clear(), which is safe).
