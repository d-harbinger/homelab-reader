# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-05-31)

**Core value:** Point the server at a folder of books and every device — PCs in the browser, phones via android-reader/OPDS — reads the same library, with each person's notes, highlights, and progress kept private to them.
**Current focus:** Phase 1 — Authorization Hardening + Test Harness

## Current Position

Phase: 1 of 3 (Authorization Hardening + Test Harness)
Plan: 0 of TBD in current phase
Status: Ready to plan
Last activity: 2026-05-31 — Roadmap created (3 coarse phases, 16 requirements mapped)

Progress: [░░░░░░░░░░] 0%

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

### Pending Todos

None yet.

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
Stopped at: Roadmap and STATE created; requirements traceability filled.
Resume file: None
