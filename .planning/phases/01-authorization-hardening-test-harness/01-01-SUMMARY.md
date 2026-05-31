---
phase: 01-authorization-hardening-test-harness
plan: 01
subsystem: api-authorization
tags: [authz, idor, security, refactor, next15, prisma]
requires:
  - "src/lib/current-user.ts typed errors + requireAdmin/getCurrentUserId seam (pre-existing)"
provides:
  - "Shared authError(e) HTTP mapper, single home in src/lib/current-user.ts"
  - "Admin-gated POST /api/scan"
  - "401-on-missing-session for notes/highlights/progress (POST+GET)"
  - "User-scoped GET /api/progress/recent (cross-user leak closed)"
affects:
  - "All routes that translate auth failures to HTTP status (now import one authError)"
tech-stack:
  added: []
  patterns:
    - "Per-route try/catch -> shared authError (no withAuth HOC wrapper, per locked decision)"
    - "where: { userId } scoping on collection/aggregate queries (IDOR defense)"
key-files:
  created: []
  modified:
    - src/lib/current-user.ts
    - src/app/api/locations/route.ts
    - src/app/api/locations/[id]/route.ts
    - src/app/api/users/route.ts
    - src/app/api/users/[id]/route.ts
    - src/app/api/fs/route.ts
    - src/app/api/scan/route.ts
    - src/app/api/notes/route.ts
    - src/app/api/highlights/route.ts
    - src/app/api/progress/route.ts
    - src/app/api/progress/recent/route.ts
decisions:
  - "authError promoted to current-user.ts (adds a next/server NextResponse import to that lib file, accepted per locked decision)."
  - "GET /api/scan status path left open to any authenticated caller; only POST gated."
  - "progress/recent user-scope folded into this plan (Research Pitfall 4 / Open Question 2 resolved: fix here)."
metrics:
  duration: ~4 min
  completed: 2026-05-31
  tasks: 3 (plus 1 deviation fix)
  files_modified: 11
  commits: 4
---

# Phase 01 Plan 01: Authorization Hardening (code-change half) Summary

Closed two known authorization defects (admin-ungated rescan, broken-auth 500s) plus a scope-adjacent cross-user aggregate leak, and promoted the duplicated `authError(e)` error-to-status mapper into a single home in `src/lib/current-user.ts` — no new wrapper abstraction, per-route try/catch matching the existing convention.

## What was built

**Task 1 — `authError` promotion + import rewire** (commit `9971241`)
- Added `export function authError(e): NextResponse` to `src/lib/current-user.ts`, importing `NextResponse` from `next/server` (the first framework import in that lib file — accepted tradeoff for a single source of truth).
- Deleted the two identical local copies in `locations/route.ts` and `users/route.ts`; both now import `authError` from `@/lib/current-user`. Dropped their now-unused `ForbiddenError`/`UnauthenticatedError` imports.
- `users/[id]/route.ts` now imports `authError` from `@/lib/current-user` (was `../route`).
- `fs/route.ts` replaced its hand-inlined 401/403 `instanceof` block with `return authError(e);` and dropped the unused typed-error imports.

**Task 2 — admin gate + data-route 401 wrapping** (commit `7042bb9`)
- `POST /api/scan` now runs `try { await requireAdmin(); } catch (e) { return authError(e); }` as its first statements, before any `listScanLocations()`/filesystem work — reader → 403, signed-out → 401. `GET /api/scan` status path left untouched (open to any authenticated caller, per locked decision).
- Wrapped the previously-unguarded `getCurrentUserId()` at all six call sites (`notes`, `highlights`, `progress` — each POST + GET) in `let userId; try { userId = await getCurrentUserId(); } catch (e) { return authError(e); }`. A missing/expired session now returns 401 JSON instead of an unhandled 500. Authenticated behavior and the existing `unknown book` 404 / body-validation ordering are unchanged.

**Task 3 — `progress/recent` user scope** (commit `f763f8e`)
- Added auth resolution + `userId` to the `findMany` where-clause: `where: { userId, anchor: { not: null } }`. The `orderBy`, `take: 12`, and `include` are unchanged. The "Continue reading" aggregate now returns only the caller's books; signed-out → 401.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1/3 - Blocking dangling import] `locations/[id]/route.ts` imported authError from `../route`**
- **Found during:** post-Task-3 cross-file sanity sweep.
- **Issue:** The plan's reference map listed only `users/[id]/route.ts` as importing `authError` from `../route`. A second consumer, `src/app/api/locations/[id]/route.ts:8`, also did `import { authError } from "../route"`. Task 1 removed that export from `locations/route.ts`, leaving a dangling import that would have failed `tsc` host-side.
- **Fix:** Rewired it to `import { authError, requireAdmin } from "@/lib/current-user";` — same treatment as `users/[id]`, consistent with the plan's "authError lives only in current-user.ts; all consumers import it from there" intent.
- **Files modified:** `src/app/api/locations/[id]/route.ts`
- **Commit:** `f1f0d82`

A repo-wide grep confirms no `from "../route"` authError imports remain and `authError` is defined in exactly one file (`src/lib/current-user.ts`).

## Threat register outcome

| Threat ID | Disposition | Status in source |
|-----------|-------------|------------------|
| T-01-01 (EoP, POST /api/scan) | mitigate | Done — `requireAdmin()` + `authError` before any scan work. |
| T-01-02 (broken-auth 500 leak, data routes) | mitigate | Done — all six getCurrentUserId() sites wrapped to 401. |
| T-01-03 (unscoped progress/recent aggregate) | mitigate | Done — `where: { userId }` + auth wrap. |
| T-01-04, T-01-05 | accept (unchanged this plan) | Untouched; regression guards land in Plan 01-02. |

## Acceptance criteria: source-verified here vs. pending host-run

**Source-verified in this environment (grep gates, all green):**
- `authError` exists only in `src/lib/current-user.ts` (imports `NextResponse`); no duplicate `function authError` in any route; all consumers (`locations`, `locations/[id]`, `users`, `users/[id]`, `fs`) import it from `@/lib/current-user`; no `from "../route"` authError imports remain.
- `POST /api/scan` contains `await requireAdmin()` + `catch -> authError`; `GET` in `scan/route.ts` has no `requireAdmin`.
- `notes`/`highlights`/`progress` each reference `authError` 3× (import + two catch sites) — both POST and GET wrapped.
- `progress/recent` calls `getCurrentUserId()` in a try/catch and its `findMany` where-clause includes `userId`; `anchor: { not: null }`, `orderBy`, `take: 12`, `include` all still present.

**PENDING host-run confirmation (cannot execute in this environment — host/VM split):**
- `npx tsc --noEmit` clean (catches the moved-`authError` import rewiring — the dangling `locations/[id]` import is the exact class of error this would surface; fixed in source but unverified by a real typecheck here).
- `npm run lint` passes.
- Behavioral status-code claims (reader → 403, signed-out → 401, cross-user exclusion) are authored-but-unverified until the Plan 01-02 Vitest suite runs green on the host. No test was executed and none is claimed to have passed.

## Known Stubs

None — all edits wire real authorization logic into existing data paths; no placeholder/empty values introduced.

## Commits

- `9971241` refactor(01-01): promote authError into current-user.ts and rewire imports
- `7042bb9` fix(01-01): gate POST /api/scan to admins and 401 unguarded data routes
- `f763f8e` fix(01-01): scope GET /api/progress/recent to the calling user
- `f1f0d82` fix(01-01): rewire locations/[id] authError import to @/lib/current-user (deviation)

## Self-Check: PASSED

- `src/lib/current-user.ts` modified, `export function authError` present — FOUND.
- All four task commits present in `git log` — FOUND (`9971241`, `7042bb9`, `f763f8e`, `f1f0d82`).
- No `from "../route"` authError imports remain repo-wide — VERIFIED.
