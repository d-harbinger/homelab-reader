---
phase: 02-opds-per-user-authentication
plan: 01
subsystem: opds-auth
tags: [opds, auth, prisma, security, tokens]
requires:
  - Phase 1 test harness (vitest.config.mts, tests/helpers/test-db.ts, ephemeral-DB recipe)
  - docs/OPDS-AUTH-CONTRACT.md (cross-repo wire contract)
provides:
  - OpdsToken Prisma model (hashed-at-rest per-user OPDS credential)
  - authenticateOpds(req) guard + opdsChallenge() 401 helper (src/lib/opds-auth.ts)
  - In-route auth on /api/opds, /api/opds/all, /api/opds/recent
  - /api/opds/progress (OPDS-context progress write attributed to token owner)
affects:
  - android-reader (separate repo) — depends on exact wire conformance
tech-stack:
  added: []           # node:crypto + existing deps only; no new packages
  patterns:
    - "SHA-256 hex hashed-at-rest tokens, looked up by hash, timingSafeEqual confirm"
    - "In-route OPDS auth (middleware-exempt), Basic + Bearer accepted"
    - "Fire-and-forget lastUsedAt bump (never awaited)"
key-files:
  created:
    - src/lib/opds-auth.ts
    - src/app/api/opds/progress/route.ts
    - tests/opds-auth.test.ts
  modified:
    - prisma/schema.prisma
    - src/app/api/opds/route.ts
    - src/app/api/opds/all/route.ts
    - src/app/api/opds/recent/route.ts
    - src/auth.config.ts
decisions:
  - "Token hashed with SHA-256 (high-entropy secret -> fast crypto hash correct, not bcrypt)"
  - "Guard returns the full User row; routes use user.id for progress attribution"
  - "OPDS progress gets its own route (/api/opds/progress); web /api/progress untouched"
metrics:
  duration: ~3m (source authoring only; host-run gates pending)
  completed: 2026-05-31
requirements: [OPDS-01, OPDS-02, OPDS-03, OPDS-04]
---

# Phase 2 Plan 01: OPDS Per-User Authentication (server core) Summary

Per-user OPDS token auth enforced in-route on every OPDS endpoint: HTTP
Basic/Bearer accepted, tokens hashed at rest (SHA-256) and constant-time
confirmed, 401 + the contract's exact `WWW-Authenticate` challenge on failure,
and a dedicated OPDS-context progress write attributed to the token owner.

## What was built

- **OpdsToken model** (`prisma/schema.prisma`): `id` (cuid), `userId`
  (FK + `@@index`, cascade delete), `tokenHash` (`@unique`, the SHA-256 hex of
  the token — no plaintext column), `label`, `createdAt`, `lastUsedAt?`. Plus
  the `opdsTokens OpdsToken[]` back-relation on `User`.
- **`src/lib/opds-auth.ts`**: `authenticateOpds(req): Promise<User | null>` —
  parses `Authorization` (case-sensitive `Basic `/`Bearer ` prefixes; Basic
  splits on the FIRST colon so colons in the token survive), SHA-256 hashes the
  token, `prisma.opdsToken.findUnique({ where: { tokenHash }, include: { user }})`,
  then `timingSafeEqual` confirms the stored vs recomputed hash before trusting
  the row. On success a fire-and-forget `lastUsedAt` bump runs (never awaited).
  `opdsChallenge(body?)` returns `401` with
  `WWW-Authenticate: Basic realm="homelab-reader OPDS"`. Token/hash never logged.
- **Three guarded routes** (`/api/opds`, `/api/opds/all`, `/api/opds/recent`):
  GET signature changed to `(req)`, `authenticateOpds(req)` first, null ->
  `opdsChallenge()`. Feed XML and content types unchanged.
- **`/api/opds/progress`** (new POST): authenticates with the token guard (not
  the cookie session), attributes the upsert to `user.id`, mirrors
  `/api/progress` validation (404 unknown book, percent clamped 0..1,
  `bookId_userId` upsert).
- **`src/auth.config.ts`**: kept the `/api/opds` middleware exemption and its
  `return true`; reworded only the comment to state in-route enforcement.
- **`tests/opds-auth.test.ts`**: ephemeral-DB recipe (vi.hoisted client +
  `vi.mock("@/lib/prisma")`); guard unit cases (null / Basic / Bearer /
  wrong-token / malformed / no-colon / colon-in-token), the challenge header,
  route-level 401+challenge on all three routes, Basic 200 + `<feed`, Bearer
  200, wrong-token 401, and per-user progress attribution (Alice's token writes
  Alice's row, percent clamped, NOT Bob's; no token -> 401 + zero rows).

## Contract conformance (docs/OPDS-AUTH-CONTRACT.md)

| Contract clause | Status (source) |
|-----------------|-----------------|
| Accept Basic `base64(user:token)` and `Bearer <token>` | Done — both branches in `extractToken` |
| 401 + `WWW-Authenticate: Basic realm="homelab-reader OPDS"` | Done — exact string in `opdsChallenge` |
| Token hashed at rest (SHA-256 hex), plaintext never stored/logged | Done — `tokenHash @unique`, no plaintext column, no `console.*` |
| Constant-time compare | Done — `timingSafeEqual` after the indexed lookup |
| `lastUsedAt` bump, non-blocking | Done — `void prisma...update().catch()`, not awaited |
| Protect all three OPDS routes | Done — guard first in each GET |
| Keep `auth.config.ts` exemption | Done — exemption + `return true` unchanged, comment reworded |

Token mint (`randomBytes(32).toString("base64url")`) and the token-management
UI/REST are intentionally NOT in this plan — they are the next plan's scope.

## Deviations from Plan

None — plan executed as written. Task 1's migration generation is a host step
by design (see Pending Host-Run Gates), not a deviation.

## Verified here vs pending host-run

**Source-verified in-agent (grep/source assertions only):**
- Schema contains `model OpdsToken`, `opdsTokens OpdsToken[]`, `tokenHash @unique`, `@@index([userId])`.
- `src/lib/opds-auth.ts` exports `authenticateOpds` + `opdsChallenge`; uses `timingSafeEqual`; carries the exact realm string; no `console.*`.
- All three OPDS routes and `/api/opds/progress` grep-match `authenticateOpds`.
- `auth.config.ts` exemption + `return true` intact.
- `tests/opds-auth.test.ts` references the challenge header and progress attribution.

**Pending host-run gates (host/VM split — NOT run, NOT claimed to pass):**
The agent environment cannot run Prisma, npm, or the TypeScript compiler. The
code references `prisma.opdsToken`, whose TS types only exist after the host
generates the client — expected and fine. On the host, in repo root, run in
order:
1. `npx prisma migrate dev --name opds_tokens` — generates + applies the
   migration AND regenerates the Prisma client. Commit the generated
   `prisma/migrations/<ts>_opds_tokens/` **together with** the schema (the
   schema is already committed at `899a6a0`; amend/add the migration in a
   follow-up commit on the host).
2. `npx tsc --noEmit` — expect clean (this is the first run where
   `prisma.opdsToken` types exist).
3. `npm test` — expect `tests/opds-auth.test.ts` green (guard + route +
   attribution cases). Note: also still pending from Phase 1 is
   `npm install -D vitest@^4 vite-tsconfig-paths@^6` if not yet run.
4. `npm run build` — expect clean.
5. Manual smoke: `curl -i http://localhost:3000/api/opds` -> 401 +
   `WWW-Authenticate`; with a minted token `-u <user>:<token>` -> 200 + feed.

No host command above has been run; none is claimed to have passed. Agent-side
acceptance = source assertions only.

## Known Stubs

None. (Token mint + UI are out of this plan's scope by design, not stubs — the
guard and storage are fully wired against the contract.)

## Commits

- `899a6a0` feat(02-01): add OpdsToken model (hashed-at-rest OPDS credential)
- `d799052` feat(02-01): authenticateOpds guard + opdsChallenge helper
- `9f115fe` feat(02-01): enforce OPDS token guard on all routes + OPDS progress write
- `b53d010` test(02-01): route-level OPDS auth + per-user progress attribution

## Self-Check: PASSED

- Files created exist: src/lib/opds-auth.ts, src/app/api/opds/progress/route.ts, tests/opds-auth.test.ts — confirmed.
- Commits 899a6a0, d799052, 9f115fe, b53d010 exist in `git log`.
- All success-criteria source greps return OK (see Verified-here section).
