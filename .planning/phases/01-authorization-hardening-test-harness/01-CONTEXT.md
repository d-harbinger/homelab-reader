# Phase 1: Authorization Hardening + Test Harness - Context

**Gathered:** 2026-05-31
**Status:** Ready for planning
**Mode:** Auto-generated (autonomous smart-discuss — grounded defaults accepted)

<domain>
## Phase Boundary

Every privileged or per-user API route enforces the correct access decision,
and a Vitest harness proves it so a future refactor can't silently reopen a
gap. In scope: the `/api/scan` admin gate, auth-failure status mapping on the
notes/highlights/progress data routes, and an automated test suite covering
per-user isolation and the admin authorization gates. Out of scope: OPDS auth
(Phase 2), resource/streaming/concurrency work (Phase 3), and any new
end-user features.

Requirements: AUTHZ-01, AUTHZ-02, AUTHZ-03, AUTHZ-04, TEST-01, TEST-02.
</domain>

<decisions>
## Implementation Decisions

### Auth error mapping
- Extract the duplicated `authError(e)` helper (currently copied in `src/app/api/locations/route.ts:14` and `src/app/api/users/route.ts`) into `src/lib/current-user.ts` as a shared export, and reuse it everywhere. It maps `UnauthenticatedError → 401 {error:"unauthenticated"}`, `ForbiddenError → 403 {error:"forbidden"}`, and re-throws anything else.
- Unauthenticated/expired-session requests to `/api/notes`, `/api/highlights`, `/api/progress` return **401** with a JSON error body (wrap the `getCurrentUserId()` call in try/catch → `authError`).
- Non-admin POST to `/api/scan` returns **403** via `requireAdmin()` + `authError`.
- A request from user A for user B's row-by-id (e.g. `DELETE /api/notes/[id]`) returns **404** — do not reveal that another user's row exists. Collection endpoints simply scope by `userId` and return only the caller's rows.

### Test strategy
- Runner: **Vitest** (add `vitest` + a `test` script; Node test environment for route/scanner tests).
- Route tests call the exported route handlers directly with a `Request`/params object (no HTTP server) and assert on the returned `Response` status + JSON body.
- The single auth seam mocked is `@/auth`'s `auth()` — `current-user.ts` helpers run their real logic against the mocked session so the role/identity branches are genuinely exercised.
- Isolation tests run against a **real ephemeral SQLite database** (a temp file, `prisma migrate deploy` applied, seeded with two users) so the `userId` filter is actually proven — Prisma is NOT mocked for these.
- Tests must be runnable via `npm test` and be part of the verification flow. NOTE: actual execution is host-side (host/VM split) — the suite is authored and committed here but must be run on the host to confirm green.

### Scope of the fix
- Minimal, convention-matching: add per-route `try/catch` + the shared `authError` rather than introducing a new `withAuth` higher-order wrapper.
- Fix the known `/api/scan` POST gap AND add tests asserting every admin route (`/api/users`, `/api/users/[id]`, `/api/locations`, `/api/fs`, `/api/scan`) rejects non-admin and unauthenticated callers — the tests catch any other missing gate, not just the known one.
- Leave `GET /api/scan/status` readable to any authenticated user (it is status, not a privileged action); gate only the POST.
- Backfill tests that lock in the currently-correct per-user isolation behavior in notes/highlights/progress (TEST-02), so a future dropped `userId` filter fails CI.

### Claude's Discretion
- Exact Vitest config shape, test file layout (`__tests__/` vs co-located), and fixture/seed helpers are at implementation discretion, following existing kebab-case/`@/*` conventions.
- Whether the ephemeral test DB is per-file or per-suite, and the temp-dir mechanism, are at discretion provided isolation tests cannot leak state between cases.
</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/lib/current-user.ts` — `getCurrentUser`, `getCurrentUserId` (throws `UnauthenticatedError`), `requireAdmin` (throws `Unauthenticated`/`Forbidden`), and the `UnauthenticatedError`/`ForbiddenError` classes. The new shared `authError` belongs here.
- `authError(e)` already implemented (to be promoted) in `src/app/api/locations/route.ts:14-23` and `src/app/api/users/route.ts:51`.
- Admin routes already using the correct pattern: `src/app/api/locations/route.ts`, `src/app/api/users/route.ts`, `src/app/api/users/[id]/route.ts` (incl. last-admin / self-delete guards), `src/app/api/fs/route.ts:18`.

### Established Patterns
- Routes return hand-shaped JSON via `NextResponse.json(...)`, never raw Prisma rows; typed error subclasses map to status codes; `@/*` import alias; `node:`-protocol built-ins.
- Per-user data routes scope by `userId` from `getCurrentUserId()`: `src/app/api/notes/route.ts:33,62`, `notes/[id]/route.ts:23-26,46-49`, `highlights/route.ts:37,66`, `progress/route.ts:31,38-50,67`.

### Integration Points
- The bug to fix: `src/app/api/scan/route.ts:7` (POST calls `walkAndScan` with no `requireAdmin()`).
- The 500-not-401 bug: unguarded `getCurrentUserId()` in `notes/route.ts:33,62`, `highlights/route.ts:37,66`, `progress/route.ts:31,67`.
- Prisma client singleton: `src/lib/prisma.ts`; schema + migrations under `prisma/`.
- No test infrastructure exists yet — `package.json` has no `test` script, no runner config (confirmed in `.planning/codebase/TESTING.md`).

</code_context>

<specifics>
## Specific Ideas

- The 404-for-cross-user-row decision is a privacy choice consistent with the project's privacy posture (don't leak existence of another user's annotations).
- Tests are the deliverable that converts the currently-correct-but-unguarded isolation logic into a guarded invariant — this is the point of folding TEST-01/02 into the security phase rather than after it.
</specifics>

<deferred>
## Deferred Ideas

- Login rate limiting, transactional first-admin, and confining `/api/fs` browse root are explicitly Out of Scope this milestone (PROJECT.md) — not part of Phase 1.
- OPDS authentication is Phase 2.
</deferred>
