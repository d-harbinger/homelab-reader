---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
status: executing
stopped_at: Completed 02-01-PLAN.md (OPDS token model + in-route Basic/Bearer guard on all 3 OPDS routes + OPDS-context progress + auth tests). Source-asserted; host-run gates (prisma migrate dev, tsc, test, build) pending.
last_updated: "2026-05-31T03:26:00Z"
last_activity: 2026-05-31 -- Plan 02-01 executed (OPDS per-user auth server core authored; host migrate+test pending)
progress:
  total_phases: 3
  completed_phases: 0
  total_plans: 3
  completed_plans: 3
  percent: 50
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-05-31)

**Core value:** Point the server at a folder of books and every device — PCs in the browser, phones via android-reader/OPDS — reads the same library, with each person's notes, highlights, and progress kept private to them.
**Current focus:** Phase 02 — opds-per-user-authentication

## Current Position

Phase: 02 (opds-per-user-authentication) — EXECUTING
Plan: 02-01 of 2 (server core authored; token-management UI plan still to come)
Status: Plan 02-01 complete in source (OpdsToken model + authenticateOpds guard + 3 guarded routes + /api/opds/progress + auth tests). Awaits the host-run gate (prisma migrate dev --name opds_tokens, then tsc/test/build) before /gsd:verify-work. Phase 01 host-run green gate still pending too.
Last activity: 2026-05-31 -- Plan 02-01 executed (OPDS per-user auth server core authored; host migrate+test pending)

Progress: [█████░░░░░] 50%

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
- OPDS tokens hashed with SHA-256 (high-entropy opaque secret -> fast crypto hash correct, not bcrypt); looked up by tokenHash, timingSafeEqual confirm; no plaintext column.
- authenticateOpds returns the full User row; routes use user.id for progress attribution.
- OPDS-context progress gets its own route (/api/opds/progress, token-authed); the web /api/progress stays on the cookie session, untouched.

### Pending Todos

- **HOST-RUN GATE — Plan 02-01 (blocks Phase 02 verify):** the OPDS auth code is authored-but-unrun and references `prisma.opdsToken`, whose TS types exist only after the host generates the client. On the host, in repo root, run in order:
  1. `npx prisma migrate dev --name opds_tokens` — generates + applies the migration AND regenerates the Prisma client. Commit the generated `prisma/migrations/<ts>_opds_tokens/` together with the schema (schema already committed at `899a6a0`; add the migration in a follow-up commit on the host).
  2. `npx tsc --noEmit` — first run where `prisma.opdsToken` types exist; expect clean.
  3. `npm test` — expect `tests/opds-auth.test.ts` green (guard + route + attribution). (Also still pending from Phase 1: `npm install -D vitest@^4 vite-tsconfig-paths@^6` if not yet run.)
  4. `npm run build` — expect clean.
  5. Smoke: `curl -i http://localhost:3000/api/opds` -> 401 + `WWW-Authenticate`; `-u <user>:<token>` -> 200 + feed.
  - No host command above was run in-agent; none is claimed to pass. Agent-side acceptance = source assertions only.

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
Stopped at: Completed 02-01-PLAN.md (OPDS per-user auth server core: OpdsToken model + authenticateOpds guard + 3 guarded routes + /api/opds/progress + auth tests). Source-asserted; host-run gate (prisma migrate dev --name opds_tokens, then tsc/test/build) pending.
Resume file: .planning/phases/02-opds-per-user-authentication/02-01-SUMMARY.md
