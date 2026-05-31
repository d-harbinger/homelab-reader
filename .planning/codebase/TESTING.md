# Testing Patterns

**Analysis Date:** 2026-05-31

## Test Framework

**None. There is no automated test suite in this repository.**

This is a real, load-bearing finding — not an omission in this document. Verified by:
- No test runner in `package.json` dependencies or devDependencies. `grep -iE "jest|vitest|playwright|testing-library|mocha|chai|cypress" package.json` returns nothing.
- No test runner config files: no `jest.config.*`, `vitest.config.*`, or `playwright.config.*` anywhere in the repo.
- No test files: `find . -name "*.test.*" -o -name "*.spec.*"` (outside `node_modules`) returns nothing.
- No `__tests__/` directories.
- No `test` / `test:watch` / `coverage` script in `package.json` (`scripts` are setup, check, dev, build, start, lint, and Prisma helpers only).
- No CI workflow exercising tests — `.github/workflows/` does not exist.

**Runner:** Not applicable — none installed.

**Assertion Library:** Not applicable — none installed.

**Run Commands:**
```bash
# No test command exists. The only verification gates are:
npm run lint        # ESLint (next/core-web-vitals + next/typescript)
npx tsc --noEmit    # TypeScript strict typecheck
npm run check       # node scripts/preflight.mjs (environment preflight)
```

## Test File Organization

**Location:** Not applicable — no tests exist.

**Naming:** No convention established. If tests are introduced, the existing source naming (PascalCase components, kebab-case libs) and the `@/` import alias should carry over.

**Structure:** No test directory layout in place.

## Test Structure

Not applicable — no tests exist. No suite/`describe`/`it` patterns are established in this codebase to follow.

## Mocking

**Framework:** None.

**Patterns:** Not applicable.

**Seams that would need mocking if tests are added** (documented so a future test author knows the boundaries):
- Prisma client — exported as a `globalThis`-memoized singleton from `src/lib/prisma.ts`. A test would point `DATABASE_URL` at a throwaway SQLite file or substitute the client.
- Auth/session — `auth()` from `src/auth.ts`, consumed via `getCurrentUser` / `getCurrentUserId` / `requireAdmin` in `src/lib/current-user.ts`. This is the natural injection point for faking authenticated/admin/anonymous callers.
- Filesystem — `node:fs/promises` in `src/lib/scanner/index.ts` (`scanFile`, `walkAndScan`) and the format extractors `src/lib/scanner/epub.ts`, `src/lib/scanner/pdf.ts`.
- `chokidar` watcher — `src/lib/scanner/watcher.ts`.

## Fixtures and Factories

**Test Data:** None. No fixtures, factories, or seed-for-test helpers exist.

**Location:** Not applicable. Note: `scripts/setup.mjs` and `scripts/set-password.mjs` are operational setup tooling, not test fixtures.

## Coverage

**Requirements:** None enforced. No coverage tooling, no threshold, no badge.

**View Coverage:**
```bash
# Not applicable — no coverage tooling installed.
```

## Test Types

**Unit Tests:** None.

**Integration Tests:** None.

**E2E Tests:** None. No Playwright or Cypress.

## Current Verification Strategy

In the absence of tests, correctness is currently guarded by:
- **TypeScript strict mode** (`tsconfig.json` `strict: true`) via `npx tsc --noEmit` — the primary safety net.
- **ESLint** (`eslint.config.mjs`) via `npm run lint`.
- **Preflight script** `scripts/preflight.mjs` (`npm run check`, also run on `predev`) — environment/config sanity, not behavior.
- **Prisma migrations** — `prisma migrate deploy` runs on `predev` and in the Docker entrypoint, which fails loudly if migrations do not apply.
- **Manual / runtime checks** — defensive runtime validation inside API routes and the scanner (see `CONVENTIONS.md` → Error Handling).

## Recommended First Tests (if a suite is introduced)

Highest-value, lowest-friction targets, given the seams above. Vitest fits the Next 15 + ESM + TypeScript stack with the least config.
- **Pure validation logic** — `validate` / `createUser` username + password rules and `UserInputError` paths in `src/lib/users.ts` (no Prisma needed for the regex/length branches).
- **Auth guards** — `getCurrentUserId` and `requireAdmin` in `src/lib/current-user.ts`: assert `UnauthenticatedError`/`ForbiddenError` are thrown for the right session states (mock `auth()`).
- **Route error mapping** — `authError` in `src/app/api/users/route.ts` mapping typed errors to 401/403 and re-throwing the rest.
- **Scanner idempotency** — `scanFile` in `src/lib/scanner/index.ts` against a temp SQLite DB and temp files: re-scan is a no-op, moved-file updates path, content-change re-extracts while preserving `Book.id`.

## Common Patterns

**Async Testing:** No established pattern (no tests).

**Error Testing:** No established pattern. The code is written to make error testing straightforward — typed `Error` subclasses (`UnauthenticatedError`, `ForbiddenError`, `UserInputError`) make `expect(...).toThrow(...)` assertions clean once a runner exists.

---

*Testing analysis: 2026-05-31*
