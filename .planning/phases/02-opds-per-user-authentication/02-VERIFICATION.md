---
phase: 02-opds-per-user-authentication
verified: 2026-05-31T03:37:19Z
status: human_needed
score: 4/4
overrides_applied: 0
human_verification:
  - test: "Run host migration and confirm types compile"
    expected: "npx prisma migrate dev --name opds_tokens generates prisma/migrations/<ts>_opds_tokens/migration.sql, regenerates Prisma client, and npx tsc --noEmit exits 0 (prisma.opdsToken types now exist)"
    why_human: "Agent cannot run Prisma CLI or tsc — host/VM split. Migration file is intentionally absent from source; it is generated on the host and must be committed alongside schema."
  - test: "Run the OPDS auth test suite"
    expected: "npm test (or npx vitest run tests/opds-auth.test.ts) exits 0, all guard cases green: null on missing header, Basic+Bearer accept/reject, colon-in-token split, opdsChallenge exact header, route-level 401 on all three feeds, progress row attributed to Alice not Bob, unauthenticated progress -> 401 + zero rows"
    why_human: "Tests require the migrated ephemeral SQLite DB (prisma.opdsToken table). Cannot run in-agent."
  - test: "Run the token management test suite"
    expected: "npx vitest run tests/opds-tokens.test.ts exits 0: mint returns plaintext once + stores only hash, list omits token and tokenHash, cross-user revoke -> 404 + row survives, signed-out -> 401 on all three verbs"
    why_human: "Tests require the migrated ephemeral SQLite DB. Cannot run in-agent."
  - test: "Build"
    expected: "npm run build exits 0 — no TS errors referencing prisma.opdsToken or the new components"
    why_human: "TypeScript types for opdsToken only exist after prisma generate runs on the host."
  - test: "Smoke test OPDS auth end-to-end"
    expected: "curl -i http://localhost:3000/api/opds -> 401 + WWW-Authenticate: Basic realm=\"homelab-reader OPDS\"; curl -i -u <username>:<minted-token> http://localhost:3000/api/opds -> 200 + XML feed body containing <feed"
    why_human: "Requires a running server with a migrated DB and a minted token."
  - test: "Commit the generated migration"
    expected: "After npx prisma migrate dev --name opds_tokens, the generated file prisma/migrations/<ts>_opds_tokens/migration.sql is committed to git alongside the already-committed schema change"
    why_human: "Migration generation is a host-side step by design; the resulting file must be committed by the developer."
---

# Phase 02: OPDS Per-User Authentication — Verification Report

**Phase Goal:** OPDS clients authenticate per user against the documented contract; progress reported over OPDS is attributed to the right account.
**Verified:** 2026-05-31T03:37:19Z
**Status:** human_needed
**Re-verification:** No — initial verification

---

## Goal Achievement

All four success criteria are source-verified VERIFIED. The sole blocker to a passing status is the host/VM split: `prisma.opdsToken` types cannot exist until the host runs `npx prisma migrate dev`, and no test can be executed until that migration is applied to the ephemeral test DB. This is the expected outcome declared by both SUMMARY files — no implementation gaps were found.

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | SC-1: /api/opds, /api/opds/all, /api/opds/recent each call `authenticateOpds` first and return `opdsChallenge()` on null; both Basic and Bearer handled | VERIFIED | All three route files: line 13-14 in each calls `authenticateOpds(req)`; null guard `return opdsChallenge()` is the first conditional. Basic+Bearer both parsed in `extractToken` (opds-auth.ts:36-55). |
| 2 | SC-2: Unauthenticated OPDS request -> 401 + `WWW-Authenticate: Basic realm="homelab-reader OPDS"`; valid credentials -> feed | VERIFIED | `opdsChallenge()` (opds-auth.ts:99-104) sets status 401 and header `WWW-Authenticate: Basic realm="homelab-reader OPDS"` exactly. `OPDS_REALM` constant at line 22. Tests in opds-auth.test.ts lines 155-164 and 181-233 assert exact header string and 200 on valid token. |
| 3 | SC-3: OPDS-authenticated progress write is attributed to token owner, not cookie session or client-supplied id | VERIFIED | progress/route.ts: `authenticateOpds(req)` resolves the user (line 24-25); the upsert at line 55-67 uses `userId: user.id` (token owner), no cookie session or body-supplied id. Test at opds-auth.test.ts:241-300 asserts Alice's token writes Alice's row and not Bob's. |
| 4 | SC-4: Token scheme matches contract — base64url ≥32B entropy, SHA-256 hashed at rest, never logged, constant-time compare, copy-once mint, list never exposes token | VERIFIED | Schema: `tokenHash String @unique`, no plaintext column. Mint: `randomBytes(32).toString("base64url")` + `createHash("sha256").digest("hex")`. Guard: `timingSafeEqual` after `findUnique`. `opdsTokens/route.ts` GET uses explicit `select: { id, label, createdAt, lastUsedAt }` — tokenHash structurally unreachable. TokenManager: plaintext held in state only until dismiss, never re-fetched. No `console.*` in any of the seven files. |

**Score:** 4/4 truths verified (source-level). All truths are pending host execution gate.

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/lib/opds-auth.ts` | `authenticateOpds` + `opdsChallenge`, Basic+Bearer, SHA-256, timingSafeEqual | VERIFIED | 105 lines; all behaviors substantive and verified above |
| `src/app/api/opds/route.ts` | Guard at entry, feed on success | VERIFIED | Guard is first call in GET; real feed XML returned |
| `src/app/api/opds/all/route.ts` | Guard at entry, feed on success | VERIFIED | Same pattern |
| `src/app/api/opds/recent/route.ts` | Guard at entry, feed on success | VERIFIED | Same pattern |
| `src/app/api/opds/progress/route.ts` | OPDS-token auth, attribution to token owner | VERIFIED | Uses `authenticateOpds`; upsert uses `user.id` from guard |
| `src/auth.config.ts` | `/api/opds` middleware exemption retained + `return true` | VERIFIED | Lines 43-44: `if (pathname.startsWith("/api/opds")) return true;` |
| `prisma/schema.prisma` | `OpdsToken` model, `tokenHash @unique`, no plaintext col, `@@index([userId])`, cascade | VERIFIED | Lines 53-64; all constraints present |
| `prisma/migrations/<ts>_opds_tokens/migration.sql` | Generated migration for OpdsToken table | MISSING — host-pending | Not committed. Schema is authored; migration is generated on host via `npx prisma migrate dev --name opds_tokens`. Commit 899a6a0 message explicitly states this. Both SUMMARY files list it as a host gate. This is by-design, not a gap. |
| `src/app/api/opds-tokens/route.ts` | POST mint (plaintext once, hash stored) + GET list (no token/hash) | VERIFIED | `randomBytes(32).toString("base64url")`, stores `tokenHash`, returns `token` in 201 body; GET uses explicit `select` excluding `tokenHash` |
| `src/app/api/opds-tokens/[id]/route.ts` | DELETE per-user ownership 404 | VERIFIED | Ownership checked: `existing.userId !== userId` -> 404; own token -> 204 |
| `src/app/settings/tokens/page.tsx` | Per-user page, not admin-gated, renders TokenManager | VERIFIED | No role check; only `if (!me) redirect("/login")`; renders `<TokenManager />` |
| `src/components/TokenManager.tsx` | useSWR list, MintedBanner copy-once, revoke | VERIFIED | Full implementation — MintedBanner shows token once with navigator.clipboard; list shows label/dates only; revoke calls DELETE |
| `src/components/LibraryHeader.tsx` | KeyRound link to /settings/tokens outside isAdmin block | VERIFIED | `isAdmin` block closes at `)}` before the `/settings/tokens` Link at line 110 |
| `tests/opds-auth.test.ts` | Guard unit + route-level + progress attribution | VERIFIED | 302 lines; covers all OPDS-01/02/03/04 cases with ephemeral SQLite harness |
| `tests/opds-tokens.test.ts` | Mint/list/revoke per-user isolation | VERIFIED | Full test suite; covers mint-once, list excludes secrets, cross-user 404 |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `/api/opds/route.ts` | `src/lib/opds-auth.ts` | `import { authenticateOpds, opdsChallenge }` | WIRED | Import line 3; called line 13 |
| `/api/opds/all/route.ts` | `src/lib/opds-auth.ts` | same import | WIRED | Import line 8; called line 15 |
| `/api/opds/recent/route.ts` | `src/lib/opds-auth.ts` | same import | WIRED | Import line 8; called line 14 |
| `/api/opds/progress/route.ts` | `src/lib/opds-auth.ts` | same import | WIRED | Import line 3; called line 24 |
| `opds-auth.ts` | `prisma.opdsToken` | `findUnique({ where: { tokenHash } })` | WIRED (source) | Line 72; types pending host migrate |
| `progress/route.ts` | `prisma.progress.upsert` | `userId: user.id` from guard | WIRED | Line 55-67; attribution chain verified |
| `opds-tokens/route.ts` | `prisma.opdsToken` | `create`, `findMany(select)` | WIRED (source) | Lines 31-34 (GET) and 58-60 (POST) |
| `TokenManager.tsx` | `/api/opds-tokens` | `useSWR` + `fetch` POST | WIRED | `useSWR("/api/opds-tokens", ...)` + `fetch("/api/opds-tokens", { method: "POST" })` |
| `LibraryHeader.tsx` | `/settings/tokens` | `<Link href="/settings/tokens">` | WIRED | Line 110; outside isAdmin block confirmed |

---

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `opds-auth.ts` `authenticateOpds` | `row` from `prisma.opdsToken.findUnique` | DB lookup by `tokenHash` | Yes — real indexed DB query | FLOWING |
| `progress/route.ts` | `user.id` → `prisma.progress.upsert` | Token owner from guard | Yes — upsert writes real Progress row | FLOWING |
| `opds-tokens/route.ts` GET | `tokens` from `prisma.opdsToken.findMany` | DB query with explicit select | Yes — real DB query, no static fallback | FLOWING |
| `TokenManager.tsx` | `tokens` from `useSWR("/api/opds-tokens")` | GET /api/opds-tokens | Real API data; initial `?? []` is standard SWR loading default | FLOWING |

---

### Behavioral Spot-Checks

Step 7b: SKIPPED — host/VM split. No runnable entry points without host migration and Prisma client generation. All checks are routed to human verification.

---

### Probe Execution

Step 7c: No `scripts/*/tests/probe-*.sh` files found for this phase. No probe declarations in PLAN or SUMMARY files. SKIPPED.

---

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| OPDS-01 | 02-01, 02-02 | OPDS clients authenticate with per-user token; guard on all routes | SATISFIED | All three OPDS routes + progress route call `authenticateOpds`; mint/revoke REST wired to `prisma.opdsToken` |
| OPDS-02 | 02-01 | Unauthenticated OPDS request -> 401 + exact WWW-Authenticate header | SATISFIED | `opdsChallenge()` returns exact header; all routes call it on null |
| OPDS-03 | 02-01 | Progress reported over OPDS attributed to token owner's account | SATISFIED | `/api/opds/progress` uses `user.id` from guard, not cookie session |
| OPDS-04 | 02-01, 02-02 | Token scheme: base64url ≥32B, hashed SHA-256 at rest, copy-once, list never exposes | SATISFIED | Schema has no plaintext col; mint uses `randomBytes(32).toString("base64url")`; GET uses explicit select; TokenManager copy-once UX |

---

### Anti-Patterns Found

No anti-patterns found. Checked all seven source files (opds-auth.ts, four OPDS routes, opds-tokens/route.ts, opds-tokens/[id]/route.ts) plus TokenManager.tsx, settings/tokens/page.tsx for:
- `TBD`, `FIXME`, `XXX` — none
- `console.*` — none (explicitly verified with git grep returning empty)
- `return null` / `return []` / placeholder stubs — none; all data paths are real DB queries
- Hardcoded empty data passed to rendering — none

The `data?.tokens ?? []` in TokenManager is a standard SWR loading default, not a stub — it is overwritten by the real API response.

---

### Human Verification Required

The code passes all source-level checks. The remaining items require the host to run the Prisma CLI, which the agent environment cannot do.

**Run these in order from the repository root:**

#### 1. Generate and commit the migration

**Test:** `npx prisma migrate dev --name opds_tokens`
**Expected:** Generates `prisma/migrations/<timestamp>_opds_tokens/migration.sql` containing `CREATE TABLE "OpdsToken"` with columns `id`, `userId`, `tokenHash`, `label`, `createdAt`, `lastUsedAt`, a `UNIQUE INDEX` on `tokenHash`, and an index on `userId`. After running, commit the generated file: `git add prisma/migrations/ && git commit -m "feat(02-01): generate opds_tokens migration"` (or amend the schema commit if preferred).
**Why human:** Migration generation requires the Prisma CLI and a writable filesystem. The agent cannot run it.

#### 2. TypeScript compile check

**Test:** `npx tsc --noEmit`
**Expected:** Exits 0, no errors. This is the first run where `prisma.opdsToken` types exist (generated by step 1). Any type errors here indicate a mismatch between schema and source.
**Why human:** Requires generated Prisma types; cannot run in-agent.

#### 3. OPDS auth test suite

**Test:** `npx vitest run tests/opds-auth.test.ts`
**Expected:** All cases green — guard accepts Basic and Bearer, rejects wrong/unknown tokens, handles colon-in-token Basic split, `opdsChallenge` returns exact header, all three OPDS routes 401 on no/wrong token and 200+feed on valid token, progress route writes Alice's row with percent clamped to 1, unauthenticated progress -> 401 + zero rows.
**Why human:** Requires ephemeral SQLite migration (opds_tokens table); cannot run in-agent.

#### 4. Token management test suite

**Test:** `npx vitest run tests/opds-tokens.test.ts`
**Expected:** All cases green — mint returns plaintext once + stores only hash + no hash on response, blank label -> 400, signed-out -> 401, list excludes token and tokenHash, cross-user revoke -> 404 + row survives, own revoke -> 204 + row gone, unknown id -> 404.
**Why human:** Requires ephemeral SQLite migration; cannot run in-agent.

#### 5. Build

**Test:** `npm run build`
**Expected:** Exits 0, no webpack/TypeScript errors for the new files.
**Why human:** Requires generated Prisma types.

#### 6. End-to-end smoke test

**Test:**
```
curl -i http://localhost:3000/api/opds
curl -i http://localhost:3000/api/opds/all
curl -i http://localhost:3000/api/opds/recent
```
Then sign in at the web UI, go to `/settings/tokens`, mint a token labelled "test-curl", copy it, then:
```
curl -i -u <username>:<token> http://localhost:3000/api/opds
```
**Expected:** All three unauthenticated curls return `HTTP/1.1 401` with `WWW-Authenticate: Basic realm="homelab-reader OPDS"`. The authenticated curl returns `HTTP/1.1 200` with XML body containing `<feed`. The token management page shows the token once in the amber banner with a copy button and "you won't see it again" text; after dismiss, the token appears in the list with label and date but no raw token value. Nav link (key icon) is visible when signed in as a non-admin.
**Why human:** Requires running server + migrated DB + minted token.

---

### Gaps Summary

No implementation gaps. All source code is substantive, wired, and data-flowing. The only outstanding item is the migration generation step, which is a host-side workflow artifact (not a code gap) explicitly anticipated in both SUMMARY files and in the commit message for 899a6a0. Once the host runs `npx prisma migrate dev --name opds_tokens` and commits the generated file, all four requirements are in committed shape and the test suites will exercise the full stack.

---

_Verified: 2026-05-31T03:37:19Z_
_Verifier: Claude (gsd-verifier)_
