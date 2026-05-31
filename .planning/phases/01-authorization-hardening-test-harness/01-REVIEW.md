---
phase: 01-authorization-hardening-test-harness
reviewed: 2026-05-30T00:00:00Z
depth: deep
files_reviewed: 18
files_reviewed_list:
  - src/lib/current-user.ts
  - src/app/api/scan/route.ts
  - src/app/api/notes/route.ts
  - src/app/api/highlights/route.ts
  - src/app/api/progress/route.ts
  - src/app/api/progress/recent/route.ts
  - src/app/api/locations/route.ts
  - src/app/api/locations/[id]/route.ts
  - src/app/api/users/route.ts
  - src/app/api/users/[id]/route.ts
  - src/app/api/fs/route.ts
  - tests/setup.ts
  - tests/helpers/auth-mock.ts
  - tests/helpers/test-db.ts
  - tests/authz-gates.test.ts
  - tests/isolation.test.ts
  - vitest.config.mts
  - package.json
findings:
  critical: 0
  warning: 4
  info: 4
  total: 8
status: issues_found
---

# Phase 1: Code Review Report

**Reviewed:** 2026-05-30
**Depth:** deep (cross-file: middleware gate, auth.config, all of src/app/api)
**Files Reviewed:** 18
**Status:** issues_found

## Summary

The four targeted authorization fixes are **correct**:

- **Scan gate** — `POST /api/scan` now calls `await requireAdmin()` in a try/catch
  returning `authError(e)`. `requireAdmin` throws `Unauthenticated` (signed out) or
  `Forbidden` (signed-in reader), so the route genuinely returns 401/403 and lets an
  admin through. Verified against the typed errors in `current-user.ts`.
- **Six data-route sites** — all six `getCurrentUserId()` calls in `notes/route.ts`,
  `highlights/route.ts`, `progress/route.ts` (POST+GET each) are wrapped, so an
  unauthenticated caller gets a 401 hand-shaped body, not a 500.
- **`progress/recent` leak** — now `where: { userId, anchor: { not: null } }`. The
  cross-user leak is closed. No remaining unscoped per-user `findMany` exists; the
  other unscoped `findMany`/`count` calls (`books`, `opds/*`, `tags`, `facets`,
  `scan/status`) read the **shared library**, which is not user-scoped by design.
- **`authError` promotion** — local copies removed cleanly from `locations/route.ts`
  and `users/route.ts`; all five consumer routes import it from `@/lib/current-user`.
  No route still exports or shadows the old symbol; the re-throw path is byte-identical
  to the originals (no behavior change). No broken import paths.

The test harness is **structurally sound and non-tautological**: `isolation.test.ts`
runs against a real ephemeral SQLite file (migrate deploy + real PrismaClient bound by
`datasources` url, injected via hoisted `vi.mock("@/lib/prisma")`), only the `@/auth`
seam is faked, and each isolation assertion would genuinely FAIL if the `userId` filter
or ownership check were removed (confirmed by tracing each seed/assertion pair). Dynamic
`[id]` handlers receive `params` as `Promise.resolve({ id })`, matching Next 15.

Remaining issues are consistency/robustness gaps and a few test-fragility items — none
exploitable given the middleware cookie-gate, hence no Critical findings.

## Warnings

### WR-01: By-id ownership routes call `getCurrentUserId()` un-wrapped — inconsistent with the phase's own hardening

**File:** `src/app/api/notes/[id]/route.ts:22,45` and `src/app/api/highlights/[id]/route.ts:21,43`
**Issue:** The phase wrapped the six collection-route `getCurrentUserId()` sites so an
unauthenticated caller gets 401 instead of an uncaught throw (500). The four by-id
PATCH/DELETE sites in `notes/[id]` and `highlights/[id]` were left calling
`getCurrentUserId()` raw, with no try/catch and no `authError`. This is the same class
of code the phase set out to harden, left in two files.

It is **not currently exploitable**: `src/middleware.ts` runs the `authorized` callback
on every path except `/api/opds`, `/setup`, `/login`, `/api/auth`, so a genuinely
signed-out request to `/api/notes/[id]` is bounced to `/login` before the handler runs,
and the defensive throw is unreachable. That is exactly why it is a Warning, not a
Blocker — but it leaves an inconsistent invariant (some handlers self-defend, sibling
handlers rely entirely on middleware) and a 500-shaped failure mode if the matcher is
ever narrowed. The isolation tests pass `asReader(seed.userA)` (a real session), so they
never exercise the un-wrapped throw path and would not catch a regression here.
**Fix:** Wrap for parity, e.g. in `notes/[id]/route.ts`:
```ts
let userId: string;
try {
  userId = await getCurrentUserId();
} catch (e) {
  return authError(e);
}
const existing = await prisma.note.findUnique({ where: { id } });
```
Apply to both PATCH and DELETE in `notes/[id]` and `highlights/[id]` (4 sites). Import
`authError` alongside `getCurrentUserId`.

### WR-02: `isolation.test.ts` duplicates `makeTestDb()` inline instead of using it; `void makeTestDb` is a no-op import to dodge lint

**File:** `tests/isolation.test.ts:30-36,56` (and `tests/helpers/test-db.ts:31-55`)
**Issue:** The ephemeral-DB recipe (mkdtemp → url → `migrate deploy` → `new
PrismaClient({ datasources })`) is hand-copied into the `vi.hoisted()` block and again in
`beforeAll`, while the canonical `makeTestDb()` helper is imported only to be discarded
with `void makeTestDb;`. The two copies can drift (e.g. if `test-db.ts` later adds a
`PRAGMA`, a pool setting, or a different migrate invocation, the isolation suite silently
won't get it), defeating the helper's stated "can never drift from production" purpose.
The `void` statement plus the long apologetic comment is a code smell signalling the
abstraction doesn't fit the hoisting constraint.
**Fix:** Either (a) make `makeTestDb()` usable from a hoisted context by splitting it into
a synchronous `makeTestDbSync()` (file + migrate + client, no async needed — `migrate
deploy` is already `execFileSync`) and call that from `vi.hoisted()`, then drop the inline
duplication and the `void makeTestDb`; or (b) if the helper genuinely cannot be hoisted,
delete the unused import and the `void` line and add a one-line comment that the recipe is
intentionally inlined — don't keep a dead import alive with `void`.

### WR-03: `execFileSync("npx", ["prisma","migrate","deploy"])` with `stdio: "inherit"` is fragile and noisy in the test path

**File:** `tests/helpers/test-db.ts:39-42` and `tests/isolation.test.ts:62-65`
**Issue:** Spawning `npx prisma` per suite (twice — once in the hoisted recipe's
`beforeAll`, and once more anywhere `makeTestDb()` is actually called) makes the test
depend on `npx` resolving `prisma` from `node_modules/.bin`, on network/cache state for
`npx`, and on the migration runner succeeding silently. `stdio: "inherit"` dumps Prisma's
full migration banner into test output on every run. If `migrate deploy` fails (no
binary, locked file), the throw surfaces as an opaque `beforeAll` failure unrelated to the
code under test. This is test-reliability, hence in scope.
**Fix:** Invoke the local binary directly to avoid the `npx` resolution layer, and
suppress chatter while preserving errors:
```ts
execFileSync(
  process.platform === "win32" ? "npx.cmd" : "npx",
  ["--no-install", "prisma", "migrate", "deploy"],
  { env: { ...process.env, DATABASE_URL: url }, stdio: ["ignore", "ignore", "inherit"] },
);
```
`--no-install` fails fast instead of hitting the network; routing stdout to `ignore`
keeps the migration banner out of the report while leaving stderr for real failures.

### WR-04: `authz-gates.test.ts` admin happy-path mocks the scanner but never asserts the gate let the *work* run — only that status ≠ 401/403

**File:** `tests/authz-gates.test.ts:86-93`
**Issue:** The "admin passes the gate" test asserts `status` is not 401, not 403, and is
200. Because `listScanLocations` is mocked to `[]`, a handler that *skipped*
`requireAdmin()` entirely would also reach the 200 summary — so this test proves "admin
gets 200" but does **not** prove the gate was the thing that admitted them vs. the gate
being absent for everyone. The negative cases (401/403) do carry the proof that the gate
exists and rejects, so the suite as a whole is sound; this single positive case is weaker
than it reads and risks a false sense of "admin path verified."
**Fix:** Strengthen the positive case to prove the gate was consulted, e.g. assert
`vi.mocked(auth)` was called, or add one case where an admin session with a malformed role
is rejected. Minimal: `expect(vi.mocked(auth)).toHaveBeenCalled()` after the 200 assertion
ties the success to the auth seam actually running.

## Info

### IN-01: `tests/setup.ts` sets a placeholder `DATABASE_URL` but relies on the gate suite never querying — brittle if a future gate test adds a DB-touching branch

**File:** `tests/setup.ts:50-54`
**Issue:** The comment correctly notes the gate suite "never queries" because 401/403
short-circuit before Prisma. That invariant holds today (verified: every parameterized
case in `authz-gates.test.ts` is signed-out or reader). If someone later adds an admin
happy-path that hits Prisma (e.g. `GET /api/users` as admin) without `vi.mock("@/lib/
prisma")`, it will silently connect to the placeholder file and the failure mode is
non-obvious. Consider documenting that any gate test exercising the admin path must mock
prisma, or fail loudly if the placeholder file is ever opened.
**Fix:** Leave as-is for now (correct), or point the placeholder at a path guaranteed to
error on connect so an accidental real query throws immediately instead of silently
creating an empty DB.

### IN-02: `auth-mock.ts` casts session via `as never`

**File:** `tests/helpers/auth-mock.ts:30`
**Issue:** `mockResolvedValue(session as never)` discards type-checking of the fake
session shape against NextAuth's `Session` type. A drift between `FakeSession` and the
real session contract (e.g. a renamed `role` field) would not be caught at compile time.
**Fix:** Type the mock against the real return: `vi.mocked(auth).mockResolvedValue(session
as unknown as Awaited<ReturnType<typeof auth>>)`, or define `FakeSession` to extend the
real `Session`. Low priority — the assertions still exercise the real branching.

### IN-03: `tests/` not in a dedicated tsconfig; `vitest`/Node test globals checked by main `tsc`

**File:** `vitest.config.mts:18-22`, `tsconfig.json` (include `**/*.ts`)
**Issue:** `tsconfig.json`'s `include: ["**/*.ts"]` pulls `tests/**` into `npx tsc
--noEmit`, which is good (tests are type-checked), but means test-only types and any
future `vitest/globals` usage land in the app's type program. `globals: false` keeps this
clean today (tests import `describe/it/expect/vi` explicitly), so there's no current
breakage. Noted so a future `globals: true` flip doesn't surprise.
**Fix:** None required now. If globals are ever enabled, add `"types": ["vitest/globals"]`
via a `tsconfig.test.json` rather than the app tsconfig.

### IN-04: `package.json` test script runs full suite including the `npx prisma migrate` subprocess — no isolation between `test` and a unit-only fast path

**File:** `package.json:15-16`
**Issue:** `"test": "vitest run"` runs both the fast pure-gate suite and the
DB-spawning isolation suite together. There's no `test:unit` for the host's quick loop
that skips the Prisma migration subprocess. Minor DX nit.
**Fix:** Optional — add `"test:gates": "vitest run authz-gates"` for a fast,
no-subprocess inner loop.

---

_Reviewed: 2026-05-30_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_
