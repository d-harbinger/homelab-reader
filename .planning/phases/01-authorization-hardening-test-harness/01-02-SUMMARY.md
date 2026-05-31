---
phase: 01-authorization-hardening-test-harness
plan: 02
subsystem: test-harness
tags: [vitest, testing, authz, idor, isolation, prisma, next15]
requires:
  - "Plan 01-01 route fixes (admin-gated POST /api/scan, 401-on-missing-session, user-scoped progress/recent) — the behaviour these tests guard"
  - "src/lib/current-user.ts requireAdmin/getCurrentUserId/authError seam (pre-existing)"
  - "src/auth.ts auth() — the single mocked seam"
provides:
  - "First automated test suite for the repo (Vitest, node env, @/* alias)"
  - "npm test script wired into the verification flow"
  - "Auth-gate regression tests: scan POST + every admin route reject reader (403) and signed-out (401)"
  - "Cross-user isolation tests against a real ephemeral SQLite DB (notes/highlights/progress by-id 404 + collection exclusion + progress/recent exclusion)"
  - "Reusable test helpers: makeTestDb/seedTwoUsers (ephemeral DB) and setSession/asReader/asAdmin (auth mock)"
affects:
  - "Future refactors of any admin gate or per-user filter now fail loudly (CI-guarded invariants)"
tech-stack:
  added:
    - "vitest ^4.1.7 (devDependency — install host-side)"
    - "vite-tsconfig-paths ^6.1.1 (devDependency — @/* alias in tests)"
  patterns:
    - "Direct route-handler calls with a Web Request + Promise params (no HTTP server)"
    - "Mock only @/auth; let real requireAdmin/getCurrentUserId branch on a fake session"
    - "Isolation tests use a REAL ephemeral SQLite file, Prisma unmocked on the data path"
    - "Prisma-singleton seam resolved via vi.mock(@/lib/prisma) injecting the temp-file client (strategy b)"
key-files:
  created:
    - vitest.config.mts
    - tests/setup.ts
    - tests/helpers/auth-mock.ts
    - tests/helpers/test-db.ts
    - tests/authz-gates.test.ts
    - tests/isolation.test.ts
  modified:
    - package.json
decisions:
  - "Prisma seam = strategy (b): vi.mock(@/lib/prisma) injects the ephemeral client (robust to import ordering); strategy (a) setupFiles-env documented as the host fallback."
  - "Per-route 401/403 assertions routed through expect401/expect403 helpers (one toBe(401)/toBe(403) literal each) to cover all 8 admin-route entries without duplication."
  - "Isolation client built in a vi.hoisted() block (sync, before the vi.mock factory) rather than via the async makeTestDb(); makeTestDb()/seedTwoUsers() remain the canonical helpers and seedTwoUsers does the seeding."
  - "scan admin happy-path mocks @/lib/scanner + locations + watcher and asserts status is neither 401 nor 403 (200 with zero locations) — full scan behaviour is Phase 3."
metrics:
  duration: ~6 min
  completed: 2026-05-31
  tasks: 5 authored (1 package-legitimacy checkpoint pre-approved; 1 host-run checkpoint pending)
  files_created: 6
  files_modified: 1
  commits: 4
---

# Phase 01 Plan 02: Vitest Harness + Auth-Gate + Isolation Tests Summary

Stood up the project's first automated test suite (Vitest, node environment, `@/*` alias) and turned the Plan 01-01 authorization fixes plus the already-correct per-user isolation logic into regression-guarded invariants: a dropped admin gate or a removed `userId` filter now fails a test instead of silently shipping. Two test styles per the locked strategy — pure auth-gate tests (mock `@/auth` only, no DB) and isolation tests against a real ephemeral SQLite file (two seeded users, Prisma unmocked).

## What was built

**Task 2 — Vitest config + test script** (commit `7b2e041`)
- `package.json`: added `"test": "vitest run"` (non-watch, for the verification gate) and `"test:watch": "vitest"`; declared `vitest ^4.1.7` and `vite-tsconfig-paths ^6.1.1` devDependencies so the committed manifest is correct ahead of the host `npm install -D`.
- `vitest.config.mts`: `environment: "node"` (route handlers + lib, not DOM — RESEARCH Pitfall 3), `tsconfigPaths()` for `@/*` resolution, `globals: false` (explicit `import { describe, it, expect, vi } from "vitest"`), `setupFiles: ["./tests/setup.ts"]`. No jsdom, no `@vitejs/plugin-react`.

**Task 3 — helpers + Prisma seam** (commit `16131a9`)
- `tests/setup.ts`: documents the Prisma-singleton seam. The singleton (`src/lib/prisma.ts`) captures `DATABASE_URL` at import and memoizes on `globalThis`, so setting the URL late is fragile. **Chosen: strategy (b)** — the isolation suite `vi.mock("@/lib/prisma")`s the ephemeral client. setup.ts sets a placeholder temp `DATABASE_URL` so the gate suite (which imports route modules that transitively import the singleton but never query it) never instantiates against a real path. Strategy (a) (setupFiles-env before first import) is documented inline as the host fallback.
- `tests/helpers/auth-mock.ts`: `setSession`/`signOut`/`asReader`/`asAdmin` over the mocked `@/auth`, using `mockResolvedValue` (auth() is async). Documents that the `vi.mock("@/auth", () => ({ auth: vi.fn() }))` call must live in the spec (hoisted, self-contained factory — RESEARCH Pitfall 2).
- `tests/helpers/test-db.ts`: `makeTestDb()` (mkdtemp + `prisma migrate deploy` against a scoped `DATABASE_URL` + `PrismaClient` with `datasources.db.url` override + `cleanup()`), and `seedTwoUsers()` creating two reader users, one book, and a B-owned Note/Highlight/Progress row, returning their ids.

**Task 4 — auth-gate tests** (commit `251ab26`)
- `tests/authz-gates.test.ts`: mocks `@/auth` (and the scanner modules for the happy-path). POST `/api/scan`: signed-out → 401 `{error:"unauthenticated"}`, reader → 403 `{error:"forbidden"}`, admin → passes the gate (200, with `@/lib/scanner` + `@/lib/scanner/locations` + `@/lib/scanner/watcher` mocked and zero locations). Every admin route — `/api/users` (GET,POST), `/api/users/[id]` (PATCH,DELETE), `/api/locations` (GET,POST), `/api/fs` (GET), `/api/scan` (POST) — asserted 401 signed-out and 403 reader; `[id]` handlers called with `{ params: Promise.resolve({ id }) }` (Next 15).

**Task 5 — isolation tests** (commit `fbebfce`)
- `tests/isolation.test.ts`: real ephemeral SQLite (client built in a `vi.hoisted()` block so it exists before the hoisted `vi.mock("@/lib/prisma")` factory; migrations + `seedTwoUsers()` in `beforeAll`). Acting as user A: DELETE and PATCH of B's note and highlight by id → 404, and B's row survives unmutated (verified by re-reading body/color). Collection GETs (`notes`, `highlights`) exclude B's rows (and return empty for A). GET `/api/progress` for B's book returns A's `{percent:0, anchor:null}` default, never B's anchor. GET `/api/progress/recent` excludes B's in-progress book (guards the Plan 01-01 user-scope fix). Prisma is NOT mocked on the data path — the real `where:{userId}` filter is exercised.

## Deviations from Plan

### Auto-fixed / discretion calls (no architectural change)

**1. [Discretion] Isolation DB client built inline via `vi.hoisted()` rather than calling `makeTestDb()` directly.**
- **Why:** `makeTestDb()` is async, but the Prisma client must exist *before* the hoisted `vi.mock("@/lib/prisma")` factory runs (vi.mock is hoisted above imports). `vi.hoisted()` is synchronous. The inline block mirrors `makeTestDb()`'s exact recipe (same `file:` url shape, same `datasources.db.url` override, same `prisma migrate deploy`); `seedTwoUsers()` from the same helper module does the seeding, and `makeTestDb` is imported + referenced with a comment documenting the equivalence and the strategy-(a) fallback. The plan explicitly permits the seed helper "either in test-db.ts or inline."
- **Files:** `tests/isolation.test.ts`, `tests/helpers/test-db.ts`. No commit beyond the Task 5 commit (`fbebfce`).

**2. [Discretion] 401/403 assertions routed through `expect401`/`expect403` helpers.**
- The plan's grep gate expects `toBe(403)`/`toBe(401)` literals; routing every admin-route case through one assertion helper keeps a single literal of each (plus the scan happy-path `not.toBe`) while still asserting all 8 route entries × 2 identities. Net coverage is broader than inlining, not narrower.

No architectural changes; no Rule-4 checkpoints; no package install attempted in-agent (host/VM split).

## Threat register outcome

| Threat ID | Disposition | Status in source |
|-----------|-------------|------------------|
| T-01-06 (regression class — gates + filters) | mitigate | Authored — Task 4 guards AUTHZ-01/04, Task 5 guards AUTHZ-03. Behavioural confirmation host-pending. |
| T-01-07 (mocking Prisma would make isolation a tautology) | mitigate | Done in source — isolation suite uses a real ephemeral SQLite DB; Prisma unmocked on the data path. |
| T-01-08 (isolation test hitting the production DB — Pitfall 1) | mitigate | Source-resolved via strategy (b) vi.mock(@/lib/prisma) + placeholder DATABASE_URL in setup.ts. **Host must confirm the suite touches only the temp DB, never ./data/homelab-reader.db.** |
| T-01-SC (supply chain — vitest + vite-tsconfig-paths install) | mitigate | Package-legitimacy checkpoint (Task 1) pre-approved by the orchestrator: both are the exact stack named in the official Next.js Vitest guide, ubiquitous first-party Vite/Vitest packages, exact spelling, not typosquats. Install runs host-side. |

## Acceptance criteria: source-verified here vs. pending host-run

**Source-verified in this environment (grep gates + file reads, all green):**
- All six deliverable files exist; `package.json` has the `test` script and both devDeps.
- `vitest.config.mts` uses `environment: "node"`, registers `tsconfigPaths()`, references `./tests/setup.ts`; no jsdom / plugin-react.
- `tests/helpers/test-db.ts` exports `makeTestDb` (migrate deploy + datasources url override + cleanup) and `seedTwoUsers`; `auth-mock.ts` uses `mockResolvedValue`.
- `tests/authz-gates.test.ts` mocks `@/auth`, imports scan POST + every admin-route handler, asserts 401 + 403 per route (incl. `[id]` with Promise params), and a scan admin-passes-gate case.
- `tests/isolation.test.ts` references `makeTestDb`, uses a real ephemeral DB (Prisma unmocked), asserts 4× `toBe(404)` cross-user mutations with row-survival, collection exclusion, and `progress/recent` exclusion.
- Each test file matches the real route contracts (status codes, JSON bodies, Promise params) confirmed by reading every handler before authoring its assertions.

**PENDING host-run confirmation (cannot execute in this environment — host/VM split; NO test was run and none is claimed to have passed):**
- `npm install -D vitest@^4 vite-tsconfig-paths@^6` succeeds; `npx vitest --version` reports 4.x.
- `npm test` exits 0 with both `tests/authz-gates.test.ts` and `tests/isolation.test.ts` green (TEST-01).
- The isolation suite touches only the temp DB, never `./data/homelab-reader.db` (Pitfall 1 / T-01-08). If it hits the real DB, the vi.mock seam needs the strategy-(a) adjustment documented in `tests/setup.ts`.
- `npx tsc --noEmit` and `npm run lint` clean across Plans 01-01 and 01-02.

## Known Stubs

None — every test exercises real handler logic against real (mocked-auth / real-DB) seams. The scanner-module mocks in the gate suite are test doubles for the happy-path return, not product stubs.

## Commits

- `7b2e041` chore(01-02): add Vitest config and test script (node env, @/* alias)
- `16131a9` test(01-02): add Vitest helpers and Prisma-seam setup
- `251ab26` test(01-02): auth-gate tests for scan + all admin routes (AUTHZ-01/04)
- `fbebfce` test(01-02): cross-user isolation against real ephemeral SQLite (AUTHZ-03/TEST-02)

## Self-Check: PASSED

- All six deliverable files exist on disk — FOUND.
- `package.json` has `"test": "vitest run"` + both devDeps — FOUND.
- All four task commits present in `git log` — FOUND (`7b2e041`, `16131a9`, `251ab26`, `fbebfce`).
- No test execution claimed; host-run green explicitly recorded as PENDING.
