---
phase: 01-authorization-hardening-test-harness
verified: 2026-05-31T03:09:31Z
status: human_needed
score: 5/5
overrides_applied: 0
human_verification:
  - test: "npm install -D vitest@^4 vite-tsconfig-paths@^6 && npm test"
    expected: "Both tests/authz-gates.test.ts and tests/isolation.test.ts pass with exit code 0; Vitest reports all cases green including the 16 admin-gate cases (8 routes x 401+403) and the 8 isolation cases (4 mutation+survival, 2 collection exclusion, 1 progress default, 1 progress/recent exclusion)."
    why_human: "Cannot run npm test in this environment (host/VM split; no node_modules). Vitest 4.x and vite-tsconfig-paths are declared as devDependencies but not yet installed. Test correctness is source-verified but behavioral pass is unconfirmed."
  - test: "npx tsc --noEmit"
    expected: "Zero type errors across all modified and created files. Key risk: the moved authError import from current-user.ts introduces the first next/server import into that lib file; the rewired locations/[id] import is the exact class of error tsc would surface if any dangling import remained."
    why_human: "Cannot run tsc in this environment."
  - test: "npm run lint"
    expected: "Zero ESLint errors."
    why_human: "Cannot run eslint in this environment."
  - test: "Confirm isolation suite writes only to a temp DB (never ./data/homelab-reader.db)"
    expected: "Running npm test shows no access to the production DB path. The vi.mock(@/lib/prisma) strategy (b) should prevent this, but only a live run confirms the singleton is not captured before the mock applies."
    why_human: "DB isolation guarantee depends on Vitest module-graph ordering at runtime; source shows correct strategy but runtime behavior cannot be verified statically."
---

# Phase 01: Authorization Hardening + Test Harness — Verification Report

**Phase Goal:** Every privileged or per-user route enforces the correct access decision, and a Vitest harness proves it so a future refactor cannot silently reopen a gap.

**Verified:** 2026-05-31T03:09:31Z
**Status:** human_needed
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | POST /api/scan returns 403 for a reader and triggers rescan for an admin | VERIFIED | `scan/route.ts` lines 9-14: `requireAdmin()` in try/catch → `authError(e)` is the first code in POST. `authError` maps ForbiddenError→403, UnauthenticatedError→401. Test in `authz-gates.test.ts` lines 77-94 asserts both negative cases + admin passes gate. |
| 2 | Unauthenticated request to /api/notes, /api/highlights, /api/progress (collection routes) returns 401 JSON, not 500 | VERIFIED | All three collection routes wrap `getCurrentUserId()` in try/catch → `authError(e)`. Notes: lines 33-37, 68-71. Highlights: lines 38-42, 71-74. Progress GET: lines 31-35, 72-76. Progress POST: lines 32-36. Progress/recent GET: lines 9-13. authError returns `{ error: "unauthenticated" }` with status 401 for UnauthenticatedError. |
| 3 | User A cannot read or mutate user B's notes/highlights/progress — proven by passing automated test using a real ephemeral SQLite DB | VERIFIED (source) / host-pending (runtime) | `isolation.test.ts` tests 4 cross-user mutations → 404 + row-survival, 2 collection GETs that exclude B's rows (real `where:{userId}` in findMany), GET /api/progress returns A's zero default not B's anchor, GET /api/progress/recent excludes B's in-progress book. Real ephemeral SQLite used via vi.hoisted() + vi.mock(@/lib/prisma) strategy (b). Notes/highlights [id] routes enforce `existing.userId !== userId → 404`. Progress/recent has `where: { userId, anchor: { not: null } }`. |
| 4 | Admin-only routes (/api/users, /api/users/[id], /api/locations, /api/fs, /api/scan) reject non-admin (403) and unauthenticated (401) — proven by automated tests | VERIFIED (source) / host-pending (runtime) | All five routes call `requireAdmin()` in a try/catch → authError gate before any business logic. `authz-gates.test.ts` covers all 8 handler entries (GET+POST users, PATCH+DELETE users/[id], GET+POST locations, GET fs, POST scan) × 2 identities via table-driven loop with `expect401`/`expect403` helpers. |
| 5 | `npm test` runs a Vitest suite that is part of the verification flow | VERIFIED (source) / host-pending (green) | `package.json` has `"test": "vitest run"` (non-watch). `devDependencies` declares `vitest: "^4.1.7"` and `vite-tsconfig-paths: "^6.1.1"`. `vitest.config.mts` exists with `environment: "node"`, `tsconfigPaths()` plugin, `setupFiles: ["./tests/setup.ts"]`, `globals: false`. Six test files authored; no test execution claimed by executor. |

**Score:** 5/5 truths source-verified (runtime confirmation host-pending)

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/lib/current-user.ts` | `authError` exported, single definition | VERIFIED | Line 54: `export function authError(e: unknown): NextResponse`. Only definition repo-wide; all 10 consumers import from `@/lib/current-user`. No duplicate definitions. |
| `src/app/api/scan/route.ts` | POST gated to admin | VERIFIED | `requireAdmin()` + `authError(e)` before any scan work. GET left open (intended — locked decision). |
| `src/app/api/notes/route.ts` | Both GET+POST wrap getCurrentUserId in try/catch→authError | VERIFIED | POST: lines 33-37. GET: lines 68-71. 3 authError references (import + 2 catch sites). |
| `src/app/api/highlights/route.ts` | Both GET+POST wrap getCurrentUserId in try/catch→authError | VERIFIED | POST: lines 38-42. GET: lines 71-74. 3 authError references. |
| `src/app/api/progress/route.ts` | Both GET+POST wrap getCurrentUserId in try/catch→authError | VERIFIED | POST: lines 32-36. GET: lines 72-76. 3 authError references. |
| `src/app/api/progress/recent/route.ts` | Scoped to userId, signed-out → 401 | VERIFIED | Lines 9-13: try/catch → authError. findMany `where: { userId, anchor: { not: null } }`. 2 authError references (import + catch). |
| `src/app/api/users/route.ts` | Admin-gated GET+POST | VERIFIED | Both handlers open with requireAdmin try/catch→authError. Imports from `@/lib/current-user`. |
| `src/app/api/users/[id]/route.ts` | Admin-gated PATCH+DELETE | VERIFIED | Both handlers open with requireAdmin try/catch→authError. Imports from `@/lib/current-user` (not `../route`). |
| `src/app/api/locations/route.ts` | Admin-gated GET+POST | VERIFIED | Both handlers open with requireAdmin try/catch→authError. |
| `src/app/api/locations/[id]/route.ts` | Imports authError from @/lib/current-user | VERIFIED | Line 2: `import { authError, requireAdmin } from "@/lib/current-user"`. Dangling `../route` import fixed in commit f1f0d82. |
| `src/app/api/fs/route.ts` | Admin-gated GET | VERIFIED | Handler opens with requireAdmin try/catch→authError. |
| `vitest.config.mts` | node env, tsconfigPaths, setupFiles | VERIFIED | All three properties confirmed. No jsdom or plugin-react. |
| `tests/setup.ts` | Documents Prisma seam, sets placeholder DATABASE_URL | VERIFIED | Sets `DATABASE_URL` to temp path if unset. Documents strategy (b) and fallback. Sets dummy AUTH_SECRET. |
| `tests/helpers/auth-mock.ts` | setSession/signOut/asReader/asAdmin with mockResolvedValue | VERIFIED | All four helpers present. Uses `vi.mocked(auth).mockResolvedValue`. Correct async mock. |
| `tests/helpers/test-db.ts` | makeTestDb + seedTwoUsers with real ephemeral SQLite | VERIFIED | makeTestDb: mkdtemp + prisma migrate deploy + datasources url override + cleanup. seedTwoUsers: 2 users, 1 book, B-owned Note+Highlight+Progress with anchor set. |
| `tests/authz-gates.test.ts` | 8 admin routes × 401+403, scan admin happy-path | VERIFIED | Table-driven loop covers all 8 entries. expect401/expect403 helpers assert status + body. Admin scan case asserts status 200. vi.mock for @/auth and scanner modules. |
| `tests/isolation.test.ts` | Real ephemeral DB, 4×404+survival, collection exclusion, progress/recent exclusion | VERIFIED | vi.hoisted() + vi.mock(@/lib/prisma) inject ephemeral client. 4 cross-user mutation cases with row-survival checks. 2 collection GET exclusion cases. 1 progress default. 1 progress/recent exclusion. |
| `package.json` | `test` script + vitest + vite-tsconfig-paths devDeps | VERIFIED | `"test": "vitest run"`, `"test:watch": "vitest"`. devDependencies: `vitest: "^4.1.7"`, `vite-tsconfig-paths: "^6.1.1"`. |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| All 10 route files | `authError` | `import from "@/lib/current-user"` | WIRED | Confirmed by grep: all 10 imports point to `@/lib/current-user`; zero `from "../route"` authError imports remain. |
| `scan/route.ts` POST | `requireAdmin()` | direct call, try/catch first | WIRED | Lines 9-14: gate runs before any business logic. |
| notes/highlights/progress collection routes | `getCurrentUserId()` | try/catch → authError per GET+POST | WIRED | 3 authError references in each of notes, highlights, progress collection routes. |
| `progress/recent/route.ts` | `userId` scope in findMany | `where: { userId, anchor: { not: null } }` | WIRED | Line 21: userId injected from getCurrentUserId; query is scoped. |
| `isolation.test.ts` | ephemeral PrismaClient | `vi.mock("@/lib/prisma")` factory + vi.hoisted() | WIRED | Client built in hoisted block before mock factory; injected into all route imports. |
| `authz-gates.test.ts` | route handlers | direct import + call | WIRED | All 8 route handler functions imported and called directly. |

---

### Behavioral Spot-Checks

Step 7b: SKIPPED — cannot run npm test in this environment (host/VM split, no node_modules installed). See Human Verification Required section for exact commands.

---

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| AUTHZ-01 | 01-01, 01-02 | POST /api/scan admin-only | SATISFIED | requireAdmin gate in scan/route.ts; test in authz-gates.test.ts describes "AUTHZ-01". |
| AUTHZ-02 | 01-01 | Unauthenticated data-route requests return 401 JSON | SATISFIED | All 6 collection-route getCurrentUserId() calls wrapped in try/catch→authError. |
| AUTHZ-03 | 01-01, 01-02 | Cross-user isolation — A cannot read/mutate B's rows | SATISFIED (source) | where:{userId} on all collection queries; `existing.userId !== userId → 404` on by-id mutations; isolation.test.ts exercises both with real DB. |
| AUTHZ-04 | 01-01, 01-02 | All admin routes reject non-admin + unauthenticated | SATISFIED | requireAdmin + authError gate on all 5 admin route files (10 handlers); authz-gates.test.ts covers all 8 entries × 2 identities. |
| TEST-01 | 01-02 | npm test script wired into verification flow | SATISFIED (source) | `"test": "vitest run"` in package.json; vitest.config.mts present; both devDeps declared. Host run pending. |
| TEST-02 | 01-02 | Isolation tests use real ephemeral SQLite | SATISFIED (source) | vi.hoisted + vi.mock(@/lib/prisma) strategy (b); execFileSync prisma migrate deploy; Prisma not mocked on data path. Host run pending. |

---

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `src/app/api/notes/[id]/route.ts` | 22, 45 | `getCurrentUserId()` called without try/catch | Info | An unauthenticated caller hitting DELETE/PATCH by-id will receive an unhandled UnauthenticatedError (500, not 401). Not in the explicit SC-2 scope (which names collection routes only) and the isolation tests always call with a valid session, so this does not block the phase goal. It is a latent gap for a future hardening pass. |
| `src/app/api/highlights/[id]/route.ts` | 21, 41 | Same as above | Info | Same pattern as notes/[id]. Same assessment. |

No TBD, FIXME, or XXX markers found in any phase-modified file. No placeholder or stub code patterns found. No hardcoded empty data that flows to rendering.

---

### Human Verification Required

#### 1. Full test suite green

**Test:** On a machine with Node >= 20 and the repo checked out, run:
```
npm install -D vitest@^4 vite-tsconfig-paths@^6
npm test
```
**Expected:** Exit 0. Both `tests/authz-gates.test.ts` and `tests/isolation.test.ts` report all cases passing. Vitest output should show: 16 cases from authz-gates (8 routes x 401 + 8 routes x 403, plus the scan admin happy-path = at minimum 17 assertions) and 8 cases from isolation (4 mutation+survival, 2 collection exclusion, 1 progress default, 1 progress/recent exclusion).
**Why human:** Cannot run npm test in this environment — no node_modules installed (host/VM split).

#### 2. TypeScript clean

**Test:**
```
npx tsc --noEmit
```
**Expected:** Zero errors. The moved authError into current-user.ts introduces the first `next/server` import into that lib file; the rewired `locations/[id]` import is the exact class of error tsc would surface if any dangling import had been missed.
**Why human:** Cannot run tsc in this environment.

#### 3. Lint clean

**Test:**
```
npm run lint
```
**Expected:** Zero ESLint errors across all modified files.
**Why human:** Cannot run eslint in this environment.

#### 4. Isolation suite does not touch the production DB

**Test:** Run `npm test` and confirm `./data/homelab-reader.db` is not accessed (e.g., check its modification timestamp before and after, or watch with `inotifywait`). Alternatively, observe that the test output shows only temp-dir paths.
**Expected:** Production DB file mtime is unchanged; all isolation queries go to a path under the OS temp directory.
**Why human:** The vi.mock(@/lib/prisma) strategy (b) is designed to prevent this, but only a live run confirms the singleton is not captured before the mock applies in the actual Vitest module graph.

---

### Gaps Summary

No source-level gaps found. All five success criteria are verified by reading the actual code and test files. The only open items are runtime confirmation items that require executing the test suite on a host with Node and the devDependencies installed.

The `notes/[id]` and `highlights/[id]` routes call `getCurrentUserId()` without a try/catch (uncaught → 500 for unauthenticated by-id requests), but this is outside the explicit scope of Success Criterion 2, which names only the collection routes. It is recorded as Info and recommended for a future hardening pass.

---

_Verified: 2026-05-31T03:09:31Z_
_Verifier: Claude (gsd-verifier)_
