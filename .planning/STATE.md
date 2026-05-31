---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
status: executing
stopped_at: Completed 01-02-PLAN.md (Vitest harness + auth-gate + isolation tests); Phase 01 plans done, host-run green pending.
last_updated: "2026-05-31T03:10:00Z"
last_activity: 2026-05-31 -- Plan 01-02 executed (Vitest test harness authored; host-run pending)
progress:
  total_phases: 3
  completed_phases: 0
  total_plans: 2
  completed_plans: 2
  percent: 33
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-05-31)

**Core value:** Point the server at a folder of books and every device — PCs in the browser, phones via android-reader/OPDS — reads the same library, with each person's notes, highlights, and progress kept private to them.
**Current focus:** Phase 01 — authorization-hardening-test-harness

## Current Position

Phase: 01 (authorization-hardening-test-harness) — EXECUTING
Plan: 2 of 2 (both plans authored)
Status: Plan 01-01 + 01-02 complete in source; Phase 01 awaits the host-run green gate (npm install -D, npm test, tsc, lint) before /gsd:verify-work
Last activity: 2026-05-31 -- Plan 01-02 executed (Vitest test harness authored; host-run pending)

Progress: [███░░░░░░░] 33%

## Performance Metrics

**Velocity:**

- Total plans completed: 0
- Average duration: —
- Total execution time: 0 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| - | - | - | - |

**Recent Trend:**

- Last 5 plans: —
- Trend: —

*Updated after each plan completion*

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- Completion = hardening, not new features (authz, OPDS auth, resource safety, tests).
- Add Vitest (not Jest/Playwright) — route + scanner unit/integration tests, folded into Phase 1 so authz fixes ship with regression tests.
- Implement OPDS auth in the route, not middleware — OPDS is deliberately middleware-exempt.
- Tune SQLite (WAL + busy_timeout + single connection) rather than move to Postgres.
- authError(e) promoted to a single home in src/lib/current-user.ts (adds a next/server import to that lib file) — per-route try/catch, no withAuth HOC.
- GET /api/scan status left open to any authenticated caller; only POST is admin-gated.
- progress/recent user-scope fix folded into Plan 01-01 (Research Pitfall 4 resolved: fix here, not deferred).

### Pending Todos

- **HOST-RUN GREEN GATE (blocks Phase 01 verify):** the entire Vitest suite is authored-but-unrun (host/VM split — `npm install`, `npm test`, `prisma migrate`, `tsc` cannot execute in-agent). On the host, in repo root, run in order:
  1. `npm install -D vitest@^4 vite-tsconfig-paths@^6` (writes the lockfile; `npx vitest --version` should report 4.x).
  2. `npm test` — expect both `tests/authz-gates.test.ts` and `tests/isolation.test.ts` green (TEST-01).
  3. Confirm the isolation suite touches ONLY the temp DB, never `./data/homelab-reader.db` (Pitfall 1 / T-01-08). If it hits the real DB, switch the isolation seam from `vi.mock(@/lib/prisma)` (strategy b) to the strategy-(a) setupFiles-env path documented in `tests/setup.ts`, and re-run.
  4. `npx tsc --noEmit` and `npm run lint` clean across Plans 01-01 and 01-02 (this also confirms the Plan 01-01 `authError` import rewiring typechecks).
- No test was executed in-agent and none is claimed to have passed; behavioral 401/403/404 + cross-user-exclusion claims for both plans become verified only after the host run above.

### Blockers/Concerns

- Verification runs on the host (host/VM split): `npm run dev`, build, Prisma, and `npm test` execute on the host, not in this environment. Name anything unverified explicitly.
- Phase 2 (OPDS) requires a Prisma schema change (token model) → `npx prisma migrate dev`; commit schema + migration together.

## Deferred Items

Items acknowledged and carried forward (v2 / out of scope this milestone):

| Category | Item | Status | Deferred At |
|----------|------|--------|-------------|
| Security | Login rate limiting / lockout | Deferred (v2) | Milestone init |
| Security | Transactional first-admin creation | Deferred (v2) | Milestone init |
| OPDS | Feed pagination | Deferred (v2) | Milestone init |
| Security | Confine `/api/fs` browse root to mounted volumes | Deferred (v2) | Milestone init |
| Sync | Per-user data export / backup API | Deferred (v2) | Milestone init |
| Scope | Per-user library scoping | Out of scope | Milestone init |
| Refactor | EPUB reader refactor (`EpubReader.tsx`) | Out of scope | Milestone init |
| Infra | Postgres migration | Out of scope | Milestone init |

## Session Continuity

Last session: 2026-05-31
Stopped at: Completed 01-02-PLAN.md (Vitest harness + auth-gate + isolation tests authored). Phase 01 plans done in source; host-run green gate pending before /gsd:verify-work.
Resume file: .planning/phases/01-authorization-hardening-test-harness/01-02-SUMMARY.md
