# Phase 1: Authorization Hardening + Test Harness - Research

**Researched:** 2026-05-30
**Domain:** Next.js 15 App Router authorization + Vitest test harness (NextAuth v5, Prisma/SQLite, TypeScript)
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
**Auth error mapping**
- Extract the duplicated `authError(e)` helper (currently copied in `src/app/api/locations/route.ts:15` and `src/app/api/users/route.ts:51`) into `src/lib/current-user.ts` as a shared export, and reuse it everywhere. It maps `UnauthenticatedError → 401 {error:"unauthenticated"}`, `ForbiddenError → 403 {error:"forbidden"}`, and re-throws anything else.
- Unauthenticated/expired-session requests to `/api/notes`, `/api/highlights`, `/api/progress` return **401** with a JSON error body (wrap the `getCurrentUserId()` call in try/catch → `authError`).
- Non-admin POST to `/api/scan` returns **403** via `requireAdmin()` + `authError`.
- A request from user A for user B's row-by-id (e.g. `DELETE /api/notes/[id]`) returns **404** — do not reveal that another user's row exists. Collection endpoints simply scope by `userId` and return only the caller's rows.

**Test strategy**
- Runner: **Vitest** (add `vitest` + a `test` script; Node test environment for route/scanner tests).
- Route tests call the exported route handlers directly with a `Request`/params object (no HTTP server) and assert on the returned `Response` status + JSON body.
- The single auth seam mocked is `@/auth`'s `auth()` — `current-user.ts` helpers run their real logic against the mocked session so the role/identity branches are genuinely exercised.
- Isolation tests run against a **real ephemeral SQLite database** (a temp file, `prisma migrate deploy` applied, seeded with two users) so the `userId` filter is actually proven — Prisma is NOT mocked for these.
- Tests must be runnable via `npm test` and be part of the verification flow. NOTE: actual execution is host-side (host/VM split) — the suite is authored and committed here but must be run on the host to confirm green.

**Scope of the fix**
- Minimal, convention-matching: add per-route `try/catch` + the shared `authError` rather than introducing a new `withAuth` higher-order wrapper.
- Fix the known `/api/scan` POST gap AND add tests asserting every admin route (`/api/users`, `/api/users/[id]`, `/api/locations`, `/api/fs`, `/api/scan`) rejects non-admin and unauthenticated callers.
- Leave `GET /api/scan/status` readable to any authenticated user (status, not a privileged action); gate only the POST.
- Backfill tests that lock in the currently-correct per-user isolation behavior in notes/highlights/progress (TEST-02).

### Claude's Discretion
- Exact Vitest config shape, test file layout (`__tests__/` vs co-located), and fixture/seed helpers are at implementation discretion, following existing kebab-case/`@/*` conventions.
- Whether the ephemeral test DB is per-file or per-suite, and the temp-dir mechanism, are at discretion provided isolation tests cannot leak state between cases.

### Deferred Ideas (OUT OF SCOPE)
- Login rate limiting, transactional first-admin, and confining `/api/fs` browse root are explicitly Out of Scope this milestone — not part of Phase 1.
- OPDS authentication is Phase 2.
- Per-user library scoping (who sees which books) — current model is a shared household library.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| AUTHZ-01 | Only an admin can trigger a rescan — `POST /api/scan` rejects non-admin with 403 | The gap is `src/app/api/scan/route.ts:7` (no guard). Fix = the exact `requireAdmin()`+`authError` pattern already in `locations/route.ts:38-42`. Test = mock `auth()` reader→403, admin→runs. |
| AUTHZ-02 | Unauthed/expired request to notes/highlights/progress → 401, not 500 | Unguarded `getCurrentUserId()` throws `UnauthenticatedError` past the route → 500. Fix = wrap in try/catch → shared `authError`. Mockable via `auth()` returning null. |
| AUTHZ-03 | A user cannot read/mutate another user's notes/highlights/progress (proven by tests) | Logic is already correct (`existing.userId !== userId` → 404 in `notes/[id]/route.ts:24`). Test = ephemeral SQLite, two seeded users, user A handler call on user B row asserts 404. |
| AUTHZ-04 | Admin routes reject non-admin and unauthed callers (proven by tests) | `/api/users`, `/api/users/[id]`, `/api/locations`, `/api/fs` already gate; `/api/scan` POST does not (AUTHZ-01). Test the whole set so any future regression fails. |
| TEST-01 | Vitest harness configured with a `test` script, runs in verification flow | No runner exists today (TESTING.md). Install Vitest 4.x + `vite-tsconfig-paths`, add `vitest.config.mts` (Node env), add `"test": "vitest run"`. |
| TEST-02 | Route-level tests cover per-user isolation (AUTHZ-03) and authz gates (AUTHZ-04, AUTHZ-01) | Two test kinds: pure-mock auth-gate tests (no DB) + ephemeral-SQLite isolation tests (real DB). Both call route handlers directly. |
</phase_requirements>

## Summary

This phase has two intertwined deliverables: (1) close two known authorization defects and promote a duplicated helper, and (2) stand up the project's first automated test suite so those fixes become guarded invariants. The codebase is unusually well-prepared for this — typed error subclasses (`UnauthenticatedError`, `ForbiddenError`), a clean `requireAdmin()`/`getCurrentUserId()` seam in `src/lib/current-user.ts`, and a single mockable auth boundary (`auth()` from `@/auth`) mean the fixes are small and the tests are direct function calls, not HTTP-server plumbing.

The code changes are mechanical and pattern-matched: the correct shape already exists in `src/app/api/locations/route.ts` and `src/app/api/users/route.ts` and just needs to be applied to `scan/route.ts` (add the missing `requireAdmin()` gate on POST) and to the three data routes (wrap the existing `getCurrentUserId()` calls in try/catch → `authError`). The `authError` helper itself is copy-pasted in two files today and gets promoted into `current-user.ts`, with the two routes re-exporting or re-importing it (note: `users/[id]/route.ts:5` imports `authError` from `../route`, so that import path must be updated when the helper moves).

The test harness is the larger effort. Two test styles are needed: **pure auth-gate tests** that mock only `auth()` and call handlers directly (fast, no DB) to prove the 401/403 gates; and **isolation tests** against a real ephemeral SQLite file (temp path, `prisma migrate deploy`, two seeded users) that prove the `userId` filter genuinely blocks cross-user access. The one structural snag is the Prisma singleton (`src/lib/prisma.ts`) reads `DATABASE_URL` at import time and memoizes on `globalThis`; isolation tests need a test-injectable client pointed at the temp DB rather than the production singleton.

**Primary recommendation:** Install Vitest 4.x with a Node-environment `vitest.config.mts` using `vite-tsconfig-paths` for `@/*`. Promote `authError` into `current-user.ts`. Fix the two defects with the existing locations/users pattern. Write auth-gate tests mocking `auth()` only; write isolation tests against a per-suite temp SQLite DB created with `new PrismaClient({ datasources: { db: { url } } })`. Author and commit here; run green on the host.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Authentication (is there a session?) | API / Backend route handler | Edge middleware | `auth()` resolves the JWT session; routes call it via `getCurrentUser`. Middleware is a coarse pre-filter, not the authorization decision. |
| Authorization (admin gate) | API / Backend route handler | — | `requireAdmin()` runs inside the handler. Middleware does not know route-specific role rules. This phase hardens exactly this tier. |
| Per-user data scoping (IDOR defense) | API / Backend route handler | Database (schema `@@unique([bookId, userId])`) | The `userId` filter and `existing.userId !== userId → 404` check live in the handler; the schema enforces the relational shape. |
| Auth-failure → HTTP status mapping | API / Backend route handler | Domain helper (`current-user.ts`) | Helpers throw typed errors; the route boundary owns the HTTP translation via `authError`. Keeps `src/lib/` framework-agnostic. |
| Test isolation seam (session + DB) | Test harness | — | `auth()` is mocked at the module boundary; the DB is a real ephemeral file. Neither is a production tier — they are the test's controlled inputs. |

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `vitest` | ^4.1.7 [VERIFIED: npm registry, published current] | Test runner + assertions + `vi.mock` | Official Next.js testing guide's recommended runner for Vite/ESM/TS projects; STATE.md already locks "Add Vitest (not Jest/Playwright)". |
| `vite-tsconfig-paths` | ^6.1.1 [VERIFIED: npm registry] | Resolves the `@/*` → `./src/*` alias from `tsconfig.json` inside Vitest | The Next.js Vitest guide [CITED: nextjs.org/docs/app/guides/testing/vitest] lists it as the path-alias plugin for TypeScript projects. Without it, `import { auth } from "@/auth"` fails to resolve in tests. |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@vitejs/plugin-react` | ^6.0.2 [VERIFIED: npm registry] | JSX/React transform for Vitest | ONLY if component tests are added. **Not needed** for this phase — all tests are route handlers + lib functions (no React). Omit to keep config minimal. |
| `@prisma/client` | ^6.19.x (already installed) | Real DB access in isolation tests | Already a dependency. Isolation tests construct a fresh `PrismaClient` pointed at a temp SQLite file. |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Direct handler calls | `next-test-api-route-handler` (NTARH) [ASSUMED] | NTARH emulates Next's resolver so `cookies()`/`headers()` work. **Not needed here** — these handlers take a plain `Request` and don't call `cookies()`/`headers()` directly (they call `auth()`, which we mock). Direct calls are simpler and CONTEXT.md locks "call the exported route handlers directly with a `Request`/params object (no HTTP server)". |
| Real ephemeral SQLite file | In-memory `file::memory:` or transaction-rollback isolation | A temp file survives the `prisma migrate deploy` child process and is shared with the test's PrismaClient; `:memory:` databases are per-connection and won't survive a separate migrate process. Transaction-rollback is faster but more machinery than a household-scale suite needs. Temp file + per-suite teardown is the locked, simplest choice. |
| `datasources` constructor override | `.env.test` + `dotenv-cli` | Prisma's docs [CITED: prisma.io/docs/orm/prisma-client/testing/integration-testing] show the `.env.test` approach for a fixed test DB. For a *per-suite throwaway* path computed at runtime, the `new PrismaClient({ datasources: { db: { url } } })` constructor override is cleaner — no second env file, URL chosen in code. Both are valid; constructor override fits the per-suite temp-file decision better. |

**Installation:**
```bash
npm install -D vitest@^4 vite-tsconfig-paths@^6
```

**Version verification:** Confirmed against npm registry on 2026-05-30: `vitest` 4.1.7, `vite-tsconfig-paths` 6.1.1, `@vitejs/plugin-react` 6.0.2. Local toolchain: Node v22.22.2, Prisma 6.19.3 (`@prisma/client` + `prisma` CLI both present). `package.json` already pins `next ^15.5.18`, `next-auth ^5.0.0-beta.30`, `@prisma/client ^6.19.2`.

## Package Legitimacy Audit

| Package | Registry | Age | Downloads | Source Repo | slopcheck | Disposition |
|---------|----------|-----|-----------|-------------|-----------|-------------|
| `vitest` | npm | ~4 yrs | very high (millions/wk) | github.com/vitest-dev/vitest | not run (unavailable) | Approved — official Next.js guide recommends it; registry-confirmed 4.1.7 |
| `vite-tsconfig-paths` | npm | ~5 yrs | high | github.com/aleclarson/vite-tsconfig-paths | not run (unavailable) | Approved — listed by name in official Next.js docs; registry-confirmed 6.1.1 |
| `@vitejs/plugin-react` | npm | ~4 yrs | very high | github.com/vitejs/vite-plugin-react | not run (unavailable) | Approved (optional) — official Vite org package; only if component tests added |

**Packages removed due to slopcheck [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

> slopcheck was not available in this environment (no network pip install). Per protocol, packages would normally be tagged `[ASSUMED]` and gated. **Mitigating factor:** all three are named explicitly in the official Next.js testing documentation (an authoritative source), and `vite-tsconfig-paths` + `@vitejs/plugin-react` are first-party Vite-ecosystem packages. The planner SHOULD still add a single `checkpoint:human-verify` before the `npm install -D` task confirming the two installed package names against npmjs.com, since names were not Context7-verified.

## Architecture Patterns

### System Architecture Diagram

```text
                  HTTP request (browser / OPDS / reader component)
                                   │
                                   ▼
        ┌───────────────────────────────────────────────────┐
        │  Edge middleware  (src/middleware.ts / auth.config) │  ← coarse cookie gate
        │  redirects signed-out browser requests to /login    │     (NOT the authz decision)
        └───────────────────────────┬───────────────────────┘
                                     ▼
        ┌───────────────────────────────────────────────────┐
        │  Route handler  src/app/api/**/route.ts             │
        │                                                     │
        │   ┌─────────────────── authz boundary ───────────┐ │
        │   │  try {                                        │ │
        │   │    await requireAdmin()        ← admin routes │ │
        │   │    const uid = getCurrentUserId() ← data rts  │ │
        │   │  } catch (e) { return authError(e) }  ────────┼─┼──► 401 / 403 JSON
        │   └───────────────────────────────────────────────┘ │
        │                       │ (authed)                     │
        │                       ▼                              │
        │   per-user scope:  where:{ userId }  (collections)   │
        │   ownership check:  existing.userId !== uid → 404    │
        └───────────────────────┬───────────────────────────┘
                                ▼
        ┌───────────────────────────────────────────────────┐
        │  current-user.ts  → auth()  → JWT session           │
        │  authError(e) helper (PROMOTED HERE this phase)     │
        └───────────────────────┬───────────────────────────┘
                                ▼
                     Prisma singleton → SQLite

   ── TEST HARNESS (parallel, this phase) ───────────────────────────
     auth-gate tests:  vi.mock("@/auth", () => ({ auth: vi.fn() }))
                       → call handler(Request) directly → assert status/body
     isolation tests:  temp SQLite file + migrate deploy + 2 seeded users
                       → new PrismaClient({ datasources:{ db:{ url } } })
                       → call handler with mocked session = user A
                       → assert user B's row → 404 / not in list
```

### Recommended Project Structure
```text
homelab-reader/
├── vitest.config.mts          # Node environment, vite-tsconfig-paths plugin
├── tests/                     # (discretion: tests/ or co-located __tests__/)
│   ├── helpers/
│   │   ├── auth-mock.ts        # vi.mock("@/auth") + setSession(null|reader|admin|userA|userB)
│   │   └── test-db.ts          # makeTestDb(): temp file + migrate deploy + PrismaClient + seed + teardown
│   ├── authz-gates.test.ts     # AUTHZ-01, AUTHZ-04 — mock auth() only, no DB
│   └── isolation.test.ts       # AUTHZ-03 — real ephemeral SQLite, two users
└── src/ ... (unchanged shape)
```

### Pattern 1: The admin-gate route pattern (already correct in locations/users)
**What:** Every admin route opens its handler with a guarded `requireAdmin()` that translates typed errors to HTTP status via `authError`.
**When to use:** `POST /api/scan` (the fix), and as the assertion target for every admin route's tests.
**Example (the EXISTING correct shape to copy):**
```typescript
// Source: src/app/api/locations/route.ts:37-42 (verified in this repo)
export async function POST(req: Request) {
  try {
    await requireAdmin();
  } catch (e) {
    return authError(e);   // UnauthenticatedError→401, ForbiddenError→403, else re-throw
  }
  // ... privileged work
}
```

### Pattern 2: The data-route auth-failure pattern (the AUTHZ-02 fix)
**What:** Wrap the existing `getCurrentUserId()` call so an expired/absent session returns 401 JSON instead of an unhandled 500.
**When to use:** `notes`, `highlights`, `progress` (collection GET + POST) and consider the `[id]` mutation routes for consistency.
**Example (target shape — apply to each unguarded call site):**
```typescript
// Target for src/app/api/notes/route.ts:33 and :62 (currently unguarded)
let userId: string;
try {
  userId = await getCurrentUserId();
} catch (e) {
  return authError(e);   // UnauthenticatedError → 401 {error:"unauthenticated"}
}
```

### Pattern 3: Per-user ownership check returning 404 (already correct — lock it with a test)
**What:** A row-by-id mutation looks the row up, then treats "not mine" identically to "doesn't exist".
**Example (the EXISTING correct shape — the invariant the isolation test guards):**
```typescript
// Source: src/app/api/notes/[id]/route.ts:23-26 (verified in this repo)
const existing = await prisma.note.findUnique({ where: { id } });
if (!existing || existing.userId !== userId) {
  return new NextResponse(null, { status: 404 });   // do not leak existence
}
```

### Pattern 4: Mocking `auth()` for handler tests
**What:** Mock the single `@/auth` module so `current-user.ts` helpers run their real branching against a controllable fake session.
**Example:**
```typescript
// vi.mock is hoisted above imports (Vitest transforms static imports to dynamic).
// Source: vitest.dev/guide/mocking/modules.html [CITED]
import { vi, beforeEach } from "vitest";
import { auth } from "@/auth";

vi.mock("@/auth", () => ({ auth: vi.fn() }));

function setSession(session: unknown) {
  vi.mocked(auth).mockResolvedValue(session as never);
}

beforeEach(() => {
  setSession(null);                                              // signed out
  // setSession({ user: { id: "u-a", role: "reader" } });        // reader
  // setSession({ user: { id: "u-admin", role: "admin" } });     // admin
});
```
Note: `getCurrentUser` reads `session?.user?.id` and `session.user.role` (`src/lib/current-user.ts:26-28`), so the fake session shape is `{ user: { id, role } }`. `auth()` is async, so use `mockResolvedValue`, not `mockReturnValue`.

### Pattern 5: Calling a dynamic `[id]` handler (Next 15 params Promise)
**What:** Next 15 dynamic route handlers receive `{ params }` where `params` is a **Promise**. The handler `await`s it (`src/app/api/notes/[id]/route.ts:9-11`). Tests must pass a Promise.
**Example:**
```typescript
import { DELETE } from "@/app/api/notes/[id]/route";

const res = await DELETE(
  new Request("http://test/api/notes/note-123", { method: "DELETE" }),
  { params: Promise.resolve({ id: "note-123" }) },   // params is a Promise in Next 15
);
expect(res.status).toBe(404);   // when note-123 belongs to another user
```

### Pattern 6: Ephemeral SQLite test DB
**What:** Create a unique temp DB file, apply migrations with `prisma migrate deploy` (env-scoped `DATABASE_URL`), construct a PrismaClient pointed at it, seed two users, tear down after.
**Example:**
```typescript
// tests/helpers/test-db.ts
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

export function makeTestDb() {
  const dir = mkdtempSync(path.join(tmpdir(), "hlr-test-"));
  const dbFile = path.join(dir, "test.db");
  const url = `file:${dbFile}`;
  // Apply the committed migrations to the throwaway file.
  execFileSync("npx", ["prisma", "migrate", "deploy"], {
    env: { ...process.env, DATABASE_URL: url },
    stdio: "inherit",
  });
  // Construct a client bound to THIS url, not the production singleton.
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  return {
    prisma,
    async cleanup() { await prisma.$disconnect(); rmSync(dir, { recursive: true, force: true }); },
  };
}
```

### Anti-Patterns to Avoid
- **Introducing a `withAuth()` HOC wrapper.** CONTEXT.md locks the minimal per-route try/catch approach; it matches the existing codebase. A wrapper is a refactor this phase explicitly declines.
- **Mocking Prisma for isolation tests.** Mocking the DB would make the `userId` filter a tautology — the test would prove only that the mock returns what it was told. The whole point of TEST-02/AUTHZ-03 is proving the *real* query scopes by user. Use the real ephemeral DB.
- **Using `jsdom` environment for route tests.** Route handlers are Node code; jsdom adds a fake DOM and is wrong here. Use `environment: "node"` (see config below). The Next.js guide's `jsdom` default is for component tests, which this phase has none of.
- **Forgetting `params` is a Promise.** Passing `{ params: { id } }` (not a Promise) will make `await params` resolve to the object by luck in some runtimes but is type-wrong under Next 15; always `Promise.resolve({ id })`.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| HTTP request simulation | A fake Express/HTTP server or supertest rig | Plain `new Request(url, init)` passed to the exported handler | Web `Request`/`Response` are the actual types Next 15 handlers use; no server needed. Locked in CONTEXT.md. |
| Session faking | A hand-built JWT signer or NextAuth test harness | `vi.mock("@/auth")` + `mockResolvedValue` | The only seam that matters is `auth()`. Mocking it lets the real `getCurrentUser/requireAdmin` branches run — higher-fidelity than faking a token. |
| Test DB lifecycle | A custom SQL bootstrap or hand-written schema in the test | `prisma migrate deploy` against a temp file | Re-uses the committed migrations (`prisma/migrations/`), so the test schema can never drift from production schema. |
| Error→status mapping | A new mapping table in each route | The promoted `authError` from `current-user.ts` | Single source of truth; the whole point of the promotion. |

**Key insight:** This codebase was written test-ready. Typed error subclasses + a single `auth()` seam + thin handlers mean the *correct* low-tech approach (mock one module, call the function, assert) beats any heavier framework. Reach for libraries only if a handler starts calling `cookies()`/`headers()` directly — none of the Phase 1 routes do.

## Runtime State Inventory

> This is an authorization-hardening + test phase, not a rename/migration. Included for completeness because it touches the `authError` symbol across modules.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | None — no data keyed on the renamed/moved symbols. The `authError` promotion is a code-only move. | None — verified: `authError` is a function, not stored anywhere. |
| Live service config | None. | None — verified: no external service references these handlers' internals. |
| OS-registered state | None. | None. |
| Secrets/env vars | Tests introduce a per-suite `DATABASE_URL` override (temp file). The production `DATABASE_URL` (`file:../data/homelab-reader.db`, `.env.example:6`) is untouched. `AUTH_SECRET` is not needed by tests (auth is mocked). | Tests set `DATABASE_URL` in a child-process env only; do not commit a `.env.test`. |
| Build artifacts / installed packages | `authError` is currently imported across files: `src/app/api/users/[id]/route.ts:5` does `import { authError } from "../route"`. When the helper moves to `current-user.ts`, this import path **must** be updated, and the two in-file definitions (`locations/route.ts:15`, `users/route.ts:51`) removed. | Code edit: update all `authError` import sites; delete the two duplicate definitions. |

**Cross-file `authError` reference map (verified by reading the files):**
- Defined in: `src/app/api/locations/route.ts:15-23` and `src/app/api/users/route.ts:51-59` (two identical copies — both deleted, promoted to `current-user.ts`).
- Imported in: `src/app/api/users/[id]/route.ts:5` (`from "../route"` → change to `from "@/lib/current-user"`).
- `src/app/api/fs/route.ts:20-26` does NOT use `authError` — it inlines the same 401/403 mapping. Optional cleanup: switch it to the shared helper for consistency (low risk; matches the "reuse it everywhere" decision).

## Common Pitfalls

### Pitfall 1: Prisma singleton ignores the per-test DATABASE_URL
**What goes wrong:** `src/lib/prisma.ts:7-11` constructs `new PrismaClient()` at import time, reading `DATABASE_URL` from the environment then, and memoizes on `globalThis`. An isolation test that sets `DATABASE_URL` later (or that imports a route which imports `@/lib/prisma`) gets the **production** client / production DB, not the temp file — so the test either hits the real DB or a stale singleton.
**Why it happens:** Module-level instantiation + `globalThis` memoization means the URL is captured once, at first import, process-wide.
**How to avoid:** Two viable strategies, planner picks one:
  1. **Mock `@/lib/prisma`** in isolation tests to return the test-scoped client: `vi.mock("@/lib/prisma", () => ({ prisma: testClient }))`. Keeps route code untouched but requires the test client to exist before the route module loads (hoisting + a shared module-level test client).
  2. **Test-injectable seam:** small refactor so the client URL can be overridden, or have the test set `DATABASE_URL` *before any import of `@/lib/prisma`* (e.g. in a Vitest `setupFiles` / globalSetup that runs first). Setting it in `setupFiles` before the singleton's first import is the lowest-touch path and keeps production code unchanged.
**Warning signs:** Isolation test mutates or reads rows in `./data/homelab-reader.db`; tests pass individually but pollute each other; `userId` assertions are green even when the filter is broken (means you're hitting a mocked/empty client).
**Recommendation:** Use `setupFiles` to set a fresh `DATABASE_URL` (temp file) before imports, OR `vi.mock("@/lib/prisma")` with the test client. Flag for the plan: **the Prisma singleton is the single structural risk in this phase** — its resolution should be an explicit early task, not discovered mid-implementation.

### Pitfall 2: `vi.mock` factory references an out-of-scope variable
**What goes wrong:** `vi.mock("@/auth", () => ({ auth: someLocalFn }))` throws "Cannot access before initialization" because `vi.mock` is hoisted above all imports and local declarations.
**Why it happens:** Vitest hoists `vi.mock` to the top of the file [CITED: vitest.dev/guide/mocking/modules.html]; the factory runs before local consts exist.
**How to avoid:** Have the factory return `{ auth: vi.fn() }` (a self-contained call), then in `beforeEach` do `vi.mocked(auth).mockResolvedValue(...)`. Or use `vi.hoisted()` to declare shared mocks. The Pattern 4 example above does this correctly.
**Warning signs:** ReferenceError / "Cannot access 'X' before initialization" on the first test run.

### Pitfall 3: Test environment defaults to jsdom from copy-pasting the Next.js guide
**What goes wrong:** Following the official guide verbatim sets `environment: "jsdom"` and pulls `@vitejs/plugin-react` + testing-library. Route-handler tests then run in a fake-DOM context with unnecessary deps.
**Why it happens:** The official guide targets component testing first.
**How to avoid:** Set `environment: "node"`. Skip `@vitejs/plugin-react` and `@testing-library/*` entirely for this phase (no component tests). Keep `vite-tsconfig-paths` (still needed for `@/*`).
**Warning signs:** Install pulls React testing libs that no test imports; slower startup.

### Pitfall 4: `progress/recent` is not user-scoped (latent cross-user leak, scope-adjacent)
**What goes wrong:** `src/app/api/progress/recent/route.ts:7-16` queries `prisma.progress.findMany({ where: { anchor: { not: null } } })` with **no `userId` filter** and no `getCurrentUserId()` call — it returns every user's in-progress books, not the caller's.
**Why it happens:** It predates the multi-user hardening; drives a "Continue reading" row that was single-user when written.
**How to avoid:** This is genuinely a per-user isolation defect in the same family as AUTHZ-03, but it is NOT named in the Phase 1 requirements (which enumerate notes/highlights/progress *collection + by-id*, and `/progress/recent` is a separate aggregate endpoint). **Flagged for the planner/discuss:** decide whether to fold the one-line `where: { userId }` fix + a test into this phase (cheap, on-theme) or defer it explicitly. Recommendation: fix it here — it's the same bug class, one line, and leaving it makes the AUTHZ-03 "user cannot read another's progress" claim only partially true.
**Warning signs:** A test that signs in as user A and asserts `/api/progress/recent` excludes user B's books would currently FAIL.

## Code Examples

### vitest.config.mts (Node environment, alias resolution)
```typescript
// Source: nextjs.org/docs/app/guides/testing/vitest [CITED] (adapted: node env, no React)
import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths()],          // resolves @/* from tsconfig.json paths
  test: {
    environment: "node",               // route handlers + lib are Node, not DOM
    globals: false,                     // import { describe, it, expect } explicitly (matches strict style)
    // setupFiles: ["./tests/setup.ts"], // if used to set DATABASE_URL before prisma singleton import
  },
});
```

### package.json test script
```json
// Source: nextjs.org/docs/app/guides/testing/vitest [CITED]
"scripts": {
  "test": "vitest run",        // non-watch for CI/verification flow (TEST-01)
  "test:watch": "vitest"       // optional dev watcher
}
```
Note: the guide uses `"test": "vitest"` (watch). For a verification-flow gate that must exit, use `vitest run`.

### Auth-gate test (AUTHZ-01 / AUTHZ-04, no DB)
```typescript
// tests/authz-gates.test.ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { auth } from "@/auth";
import { POST as scanPost } from "@/app/api/scan/route";

vi.mock("@/auth", () => ({ auth: vi.fn() }));
const setSession = (s: unknown) => vi.mocked(auth).mockResolvedValue(s as never);

describe("POST /api/scan admin gate (AUTHZ-01)", () => {
  beforeEach(() => setSession(null));

  it("401 when signed out", async () => {
    const res = await scanPost();
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthenticated" });
  });

  it("403 for a reader", async () => {
    setSession({ user: { id: "u-r", role: "reader" } });
    const res = await scanPost();
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "forbidden" });
  });
  // admin happy-path needs locations/walkAndScan — either mock @/lib/scanner
  // or run it under the ephemeral DB suite; assert it does NOT return 401/403.
});
```
Caveat: `POST` in `scan/route.ts:7` currently takes no args and calls `listScanLocations()` (which hits Prisma). The admin happy-path test needs either the ephemeral DB or a `vi.mock("@/lib/scanner")` / `vi.mock("@/lib/scanner/locations")`. The 401/403 assertions, once the gate is added, short-circuit *before* any Prisma call, so the negative tests need no DB.

### Isolation test (AUTHZ-03, real ephemeral DB)
```typescript
// tests/isolation.test.ts
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { auth } from "@/auth";
import { makeTestDb } from "./helpers/test-db";

vi.mock("@/auth", () => ({ auth: vi.fn() }));
const setUser = (id: string, role = "reader") =>
  vi.mocked(auth).mockResolvedValue({ user: { id, role } } as never);

let db: Awaited<ReturnType<typeof makeTestDb>>;
let userA: string, userB: string, bookId: string, noteOfB: string;

beforeAll(async () => {
  db = makeTestDb();                       // temp file + migrate deploy
  // NOTE: also point @/lib/prisma at db.prisma — see Pitfall 1
  const a = await db.prisma.user.create({ data: { username: "a", passwordHash: "x", role: "reader" } });
  const b = await db.prisma.user.create({ data: { username: "b", passwordHash: "x", role: "reader" } });
  userA = a.id; userB = b.id;
  const book = await db.prisma.book.create({ data: { filePath: "/x.epub", format: "epub", title: "X" } });
  bookId = book.id;
  const n = await db.prisma.note.create({ data: { bookId, userId: userB, anchor: "{}", body: "B's note" } });
  noteOfB = n.id;
});
afterAll(() => db.cleanup());

it("user A cannot DELETE user B's note → 404 (AUTHZ-03)", async () => {
  setUser(userA);
  const { DELETE } = await import("@/app/api/notes/[id]/route");
  const res = await DELETE(
    new Request(`http://t/api/notes/${noteOfB}`, { method: "DELETE" }),
    { params: Promise.resolve({ id: noteOfB }) },
  );
  expect(res.status).toBe(404);
  // and B's note still exists:
  expect(await db.prisma.note.findUnique({ where: { id: noteOfB } })).not.toBeNull();
});

it("GET /api/notes returns only the caller's notes (AUTHZ-03)", async () => {
  setUser(userA);
  const { GET } = await import("@/app/api/notes/route");
  const res = await GET(new Request(`http://t/api/notes?bookId=${bookId}`));
  const { notes } = await res.json();
  expect(notes.find((n: { id: string }) => n.id === noteOfB)).toBeUndefined();
});
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Pages Router `req`/`res` (Node `http`) handlers; supertest | App Router handlers take Web `Request`, return `Response`; call directly | Next 13→15 | No HTTP server needed; tests are plain async function calls. |
| Dynamic route `params` as a plain object | `params` is a `Promise` you `await` | Next 15 | Tests must pass `Promise.resolve({ id })`. Already the repo's signature (`notes/[id]/route.ts:9`). |
| NextAuth v4 `getServerSession(authOptions)` | NextAuth v5 universal `auth()` export from the app's auth module | v4→v5 (beta) | Single `auth()` seam to mock; no `authOptions` threading. |
| Jest + ts-jest for Next | Vitest (Vite/ESM-native) | ~2023→ now | Less config for TS/ESM; `vi.mock` hoisting handles ESM. Official Next.js guide documents Vitest. |

**Deprecated/outdated:**
- `getServerSession` / `next-auth/next` import path: v4-era; this repo is v5 (`next-auth ^5.0.0-beta.30`) — mock `@/auth`'s `auth`, not `getServerSession`.
- Treating `params` as sync: wrong under Next 15.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `next-test-api-route-handler` is unnecessary because no Phase 1 handler calls `cookies()`/`headers()` directly | Alternatives Considered | Low — verified by reading all eight target route files; they call only `auth()` (mocked) and `prisma`. If a handler is later found to read cookies directly, add NTARH for that one. |
| A2 | slopcheck-equivalent legitimacy of the three test packages (slopcheck couldn't run) | Package Legitimacy Audit | Low — all three are named in official Next.js docs and are first-party Vite/Vitest packages; planner adds one human-verify checkpoint before install. |
| A3 | `setupFiles`-set `DATABASE_URL` before first `@/lib/prisma` import will redirect the singleton | Pitfall 1 | Medium — depends on import ordering; the `vi.mock("@/lib/prisma")` fallback is guaranteed to work if setupFiles ordering proves fragile. Planner should treat the prisma seam as an explicit task and verify on host. |

## Open Questions

1. **Prisma singleton test seam — setupFiles env vs vi.mock?**
   - What we know: The singleton (`prisma.ts:7-11`) captures `DATABASE_URL` at first import and memoizes on `globalThis`. Both `setupFiles` (set env first) and `vi.mock("@/lib/prisma")` (inject test client) are viable.
   - What's unclear: Which is more robust under Vitest's per-file module isolation in this exact repo — only confirmable by running on the host (host/VM split: cannot execute here).
   - Recommendation: Plan a small spike as the first test task: stand up one isolation test, prove the route reads the temp DB (insert a row via test client, read it back through a handler). Pick the strategy that works; document it. Prefer `vi.mock("@/lib/prisma")` if setupFiles ordering is unreliable.

2. **Fold the `/api/progress/recent` user-scope fix into Phase 1?**
   - What we know: It's an unscoped aggregate that leaks all users' in-progress books (Pitfall 4). Same bug class as AUTHZ-03, one-line fix.
   - What's unclear: Whether it's in scope — requirements name the progress *collection/by-id* routes, not `/recent`.
   - Recommendation: Fix it here (one line + one test). If the planner/user prefer strict scope, defer explicitly and note it so the AUTHZ-03 "cannot read another's progress" claim is qualified.

3. **Admin happy-path for `POST /api/scan` — mock scanner or run under DB?**
   - What we know: After the gate, an admin POST proceeds to `listScanLocations()` → `walkAndScan()` (real filesystem + Prisma).
   - What's unclear: How deep the admin happy-path test should go.
   - Recommendation: For AUTHZ-01 it's enough to assert the admin call does NOT return 401/403 (mock `@/lib/scanner` + `@/lib/scanner/locations` so it returns quickly). Full scan behavior is TEST-03 / Phase 3 territory.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | Vitest runtime | ✓ (this env) | v22.22.2 | — (host runs ≥20 per `engines`) |
| `prisma` CLI | `migrate deploy` in test setup | ✓ | 6.19.3 | — |
| `@prisma/client` | isolation tests | ✓ (dep) | 6.19.x | — |
| `vitest` | runner | ✗ (not installed) | target ^4.1.7 | none — must `npm install -D` |
| `vite-tsconfig-paths` | `@/*` alias | ✗ (not installed) | target ^6.1.1 | hand-write `resolve.alias` in vitest config |
| network (npm install) | installing devDeps | host-side | — | install runs on host (host/VM split) |

**Missing dependencies with no fallback:** `vitest` — but trivially installed via `npm install -D` (a planned task, not a blocker).
**Missing dependencies with fallback:** `vite-tsconfig-paths` — if it ever conflicts, the `@/*` alias can be declared directly: `resolve: { alias: { "@": path.resolve(__dirname, "src") } }`.

**Host/VM note:** Per CLAUDE.md, `npm install`, `npm test`, `prisma migrate`, and the build run on the **host**, not in this environment. This research authors the config and tests; the suite must be run green on the host. Mark the suite "unverified — runs host-side" in the plan's verification step.

## Validation Architecture

> `.planning/config.json` not present / nyquist key absent → treated as enabled.

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest ^4.1.7 (to be installed) |
| Config file | `vitest.config.mts` (Wave 0 — does not exist yet) |
| Quick run command | `npx vitest run tests/authz-gates.test.ts` |
| Full suite command | `npm test` (`vitest run`) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| AUTHZ-01 | reader POST /api/scan → 403; signed-out → 401; admin proceeds | unit (mock auth) | `npx vitest run tests/authz-gates.test.ts` | ❌ Wave 0 |
| AUTHZ-02 | signed-out POST/GET notes·highlights·progress → 401 JSON | unit (mock auth) | `npx vitest run tests/authz-gates.test.ts` | ❌ Wave 0 |
| AUTHZ-03 | user A cannot read/mutate user B's note/highlight/progress | integration (ephemeral SQLite) | `npx vitest run tests/isolation.test.ts` | ❌ Wave 0 |
| AUTHZ-04 | /api/users, /api/users/[id], /api/locations, /api/fs, /api/scan reject non-admin + unauthed | unit (mock auth) | `npx vitest run tests/authz-gates.test.ts` | ❌ Wave 0 |
| TEST-01 | `npm test` runs and exits green | harness | `npm test` | ❌ Wave 0 |
| TEST-02 | isolation + gate coverage present | unit + integration | `npm test` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `npx vitest run <the file touched>`
- **Per wave merge:** `npm test`
- **Phase gate:** `npm test` green (on host) + `npx tsc --noEmit` + `npm run lint` before `/gsd:verify-work`.

### Wave 0 Gaps
- [ ] `vitest.config.mts` — Node env + `vite-tsconfig-paths`
- [ ] `package.json` — add `"test": "vitest run"` and devDeps
- [ ] `tests/helpers/auth-mock.ts` — `vi.mock("@/auth")` + `setSession`
- [ ] `tests/helpers/test-db.ts` — ephemeral SQLite (temp file + migrate deploy + seed + teardown)
- [ ] Prisma singleton seam decision (setupFiles env OR `vi.mock("@/lib/prisma")`) — resolve first
- [ ] Framework install: `npm install -D vitest@^4 vite-tsconfig-paths@^6` (host-side)

## Security Domain

> `security_enforcement` assumed enabled. This phase *is* the security work.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V1 Architecture | yes | Authorization decisions enforced server-side in the route handler tier (not the edge gate alone) — this phase's core. |
| V2 Authentication | partial | Session presence via NextAuth v5 `auth()`; this phase doesn't change auth, it maps auth *failure* to 401 correctly (AUTHZ-02). |
| V3 Session Management | no (unchanged) | JWT sessions handled by NextAuth; out of scope. |
| V4 Access Control | **yes (primary)** | Function-level (`requireAdmin` on every admin route — AUTHZ-01/04) and object-level (`userId` ownership check → 404 — AUTHZ-03). IDOR defense is the headline. |
| V5 Input Validation | no (unchanged) | Existing per-route shape checks; not a Phase 1 target. |
| V6 Cryptography | no | bcrypt/JWT unchanged. |
| V7 Error Handling | yes | Auth errors must return typed 401/403 JSON, never leak via unhandled 500 (AUTHZ-02). |

### Known Threat Patterns for Next.js 15 + NextAuth v5 + Prisma/SQLite

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Privilege escalation via ungated admin action (`POST /api/scan` callable by any reader) | Elevation of Privilege | `requireAdmin()` gate in the handler + regression test (AUTHZ-01). Verified gap at `scan/route.ts:7`. |
| IDOR — direct object reference to another user's note/highlight/progress by id | Information Disclosure / Tampering | Ownership check `existing.userId !== uid → 404` (already correct in `[id]` routes) + collection `where:{ userId }` scoping; locked by isolation test (AUTHZ-03). |
| Broken-auth info leak — unhandled exception surfaces a 500 (and stack/internal detail) instead of 401 | Information Disclosure | Wrap `getCurrentUserId()` → `authError` → clean 401 JSON (AUTHZ-02). |
| Existence oracle — different responses for "not found" vs "not yours" let a user enumerate others' row ids | Information Disclosure | Return identical 404 for both cases (the locked decision) — already the repo's pattern. |
| Aggregate leak — unscoped `findMany` returns all users' rows | Information Disclosure | Add `where:{ userId }` to `progress/recent` (Pitfall 4 — flagged, scope decision pending). |
| Regression reopening a closed gap during future refactor | (all) | The Vitest suite itself is the control — TEST-01/02 make every gate a CI-guarded invariant. |

## Sources

### Primary (HIGH confidence)
- **This repository (read directly, cited by file:line):** `src/lib/current-user.ts`, `src/lib/prisma.ts`, `src/auth.ts`, `src/auth.config.ts`, `src/app/api/scan/route.ts`, `src/app/api/scan/status/route.ts`, `src/app/api/notes/route.ts`, `src/app/api/notes/[id]/route.ts`, `src/app/api/highlights/route.ts`, `src/app/api/highlights/[id]/route.ts`, `src/app/api/progress/route.ts`, `src/app/api/progress/recent/route.ts`, `src/app/api/locations/route.ts`, `src/app/api/users/route.ts`, `src/app/api/users/[id]/route.ts`, `src/app/api/fs/route.ts`, `prisma/schema.prisma`, `package.json`, `tsconfig.json`, `.env.example`.
- **nextjs.org/docs/app/guides/testing/vitest** (lastUpdated 2026-05-28) — manual Vitest setup, `vite-tsconfig-paths`, config shape, test script, async Server Component caveat.
- **vitest.dev/guide/mocking/modules.html** — `vi.mock` hoisting, factory for named exports, per-test `vi.mocked().mockReturnValue`.
- **prisma.io/docs/orm/prisma-client/testing/integration-testing** — `.env.test` / migrate-deploy test-DB approach.
- **npm registry (npm view, 2026-05-30):** vitest 4.1.7, vite-tsconfig-paths 6.1.1, @vitejs/plugin-react 6.0.2; local Node v22.22.2, Prisma 6.19.3.

### Secondary (MEDIUM confidence)
- WebSearch results corroborating the direct-handler-call pattern and NextAuth v5 `auth()` mocking (Medium articles, next-auth GitHub discussions #10188 / issue #9171) — cross-checked against the official Vitest + Next.js docs above.

### Tertiary (LOW confidence)
- `next-test-api-route-handler` (NTARH) as an alternative — referenced but not adopted; marked [ASSUMED] and out of scope per A1.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — versions verified on npm registry; packages named in official Next.js docs.
- Code changes: HIGH — every target file read directly; line numbers and existing-correct patterns confirmed in-repo.
- Architecture/patterns: HIGH — direct-call + mock-`auth()` pattern confirmed against official Vitest and Next.js docs and matches the repo's own structure.
- Pitfalls: HIGH for the Prisma singleton (read the code), MEDIUM on the exact setupFiles-vs-vi.mock resolution (host-side execution required to confirm).
- Security/threat model: HIGH — threats are concrete, verified-in-code gaps, not hypotheticals.

**Research date:** 2026-05-30
**Valid until:** 2026-06-29 (30 days — stable stack; NextAuth v5 is still beta, so re-verify the `auth()` mock shape if `next-auth` bumps).
