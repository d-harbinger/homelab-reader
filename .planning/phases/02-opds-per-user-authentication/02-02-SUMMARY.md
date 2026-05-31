---
phase: 02-opds-per-user-authentication
plan: 02
subsystem: api
tags: [opds, auth, tokens, prisma, rest, ui, react, swr, security]

requires:
  - phase: 02-01
    provides: OpdsToken Prisma model (hashed-at-rest per-user credential) + the SHA-256 hashing shape in src/lib/opds-auth.ts
provides:
  - "POST /api/opds-tokens — mint a base64url token, store only its sha256 hash, return the plaintext exactly once"
  - "GET /api/opds-tokens — list the caller's tokens with an explicit select (no token, no hash)"
  - "DELETE /api/opds-tokens/[id] — per-user revoke with notes/[id]-style ownership 404"
  - "/settings/tokens page (per-user, not admin-gated) + TokenManager copy-once UI"
  - "LibraryHeader nav link to /settings/tokens for all signed-in users"
affects: [android-reader (consumes minted tokens over the OPDS contract), phase-02-verify]

tech-stack:
  added: []          # node:crypto + existing deps only (useSWR, lucide-react) — no new packages
  patterns:
    - "Copy-once secret reveal: plaintext token returned only by POST, held in client state until dismissed, never re-fetched"
    - "List endpoints use an explicit Prisma select to make secret columns unreachable, not just unrendered"
    - "By-id ownership 404 (not 403) reused for token revoke, mirroring notes/[id]"

key-files:
  created:
    - src/app/api/opds-tokens/route.ts
    - src/app/api/opds-tokens/[id]/route.ts
    - src/app/settings/tokens/page.tsx
    - src/components/TokenManager.tsx
    - tests/opds-tokens.test.ts
  modified:
    - src/components/LibraryHeader.tsx

key-decisions:
  - "Mint label trimmed + capped at 200 chars; blank label -> 400 (the only required field)"
  - "GET select lists id/label/createdAt/lastUsedAt only — tokenHash is never selected, so it cannot leak even by accident"
  - "Tokens page is NOT admin-gated (every signed-in user manages their own); nav link sits outside the isAdmin block"
  - "Token generation reuses the 02-01 shape exactly: randomBytes(32).toString('base64url') minted, createHash('sha256').digest('hex') stored"

patterns-established:
  - "Copy-once UX: MintedBanner shows the plaintext once with navigator.clipboard copy + a 'you won't see it again' note, cleared on dismiss"
  - "Per-user settings page (no role redirect) distinct from the admin-gated users/libraries pages"

requirements-completed: [OPDS-01, OPDS-04]

duration: ~6min
completed: 2026-05-30
---

# Phase 2 Plan 02: OPDS Token Management (REST + UI) Summary

**Per-user OPDS token management: mint/list/revoke REST under the cookie session with a copy-once settings page — plaintext returned exactly once, stored as SHA-256, list never exposes the token or hash, and revoke is per-user with a notes/[id]-style ownership 404.**

## Performance

- **Duration:** ~6 min (source authoring only; host-run gates pending)
- **Started:** 2026-05-30 (see Task Commits)
- **Completed:** 2026-05-30
- **Tasks:** 2
- **Files modified:** 6 (5 created, 1 modified)

## Accomplishments

- **Token REST** (`src/app/api/opds-tokens/route.ts`, `.../[id]/route.ts`): POST mints a `randomBytes(32).toString("base64url")` token, stores only its `createHash("sha256").digest("hex")`, and returns the plaintext **exactly once** in the mint response (`{ id, label, createdAt, token }`); blank/missing label -> 400. GET lists the caller's tokens via an explicit `select` of `id/label/createdAt/lastUsedAt` only — the hash is never selected. DELETE revokes with the established by-id ownership 404 (a non-owned id returns 404 and the row survives). All endpoints 401 via `authError` when signed out.
- **Settings page** (`src/app/settings/tokens/page.tsx`): per-user (NOT admin-gated — only `redirect("/login")` when signed out), mirroring the users/libraries settings shape with calm copy explaining app passwords and the once-only reveal.
- **TokenManager** (`src/components/TokenManager.tsx`): `useSWR` list + mint form. On mint, a `MintedBanner` reveals the plaintext once with a `navigator.clipboard` copy button and a clear "you won't see it again" note, cleared from state on dismiss. The list shows label/created/last-used ("never used" when null) and a per-row revoke; the raw token never appears in the list view.
- **Nav link** (`src/components/LibraryHeader.tsx`): a `KeyRound` link to `/settings/tokens`, placed **outside** the `isAdmin` block so every signed-in user reaches it.
- **Isolation tests** (`tests/opds-tokens.test.ts`): real ephemeral SQLite harness (hoisted client + `vi.mock("@/lib/prisma")` + `vi.mock("@/auth")`, `asReader` identity) proving mint-once, list-excludes-secrets, cross-user revoke 404 + row survives, unknown-id 404, and signed-out 401s.

## Task Commits

Each task was committed atomically:

1. **Task 1: Tokens REST — mint, list, revoke** - `6c89d98` (feat)
2. **Task 2: Tokens settings page, manager component, and nav link** - `2c3a6d6` (feat)

**Plan metadata:** committed with this SUMMARY (docs).

_Note: Task 1 is a `tdd="true"` task. Source-only authoring under the host/VM split means RED/GREEN were authored together in a single `feat` commit rather than separate `test`->`feat` commits — the test cannot be run in-agent to observe a real RED, so the gate sequence is satisfied on the host run (see Pending Host-Run Gates). See TDD Gate Compliance below._

## Files Created/Modified

- `src/app/api/opds-tokens/route.ts` - POST mint (plaintext once, hash stored) + GET list (explicit select, no secrets)
- `src/app/api/opds-tokens/[id]/route.ts` - DELETE revoke with per-user ownership 404 (Next 15 Promise params)
- `src/app/settings/tokens/page.tsx` - per-user (not admin-gated) tokens settings page
- `src/components/TokenManager.tsx` - client mint/list/revoke UI with copy-once MintedBanner
- `src/components/LibraryHeader.tsx` - KeyRound nav link to /settings/tokens, visible to all signed-in users
- `tests/opds-tokens.test.ts` - mint/list/revoke + per-user isolation against the real ephemeral SQLite harness

## Decisions Made

- Mint label is trimmed and capped at 200 chars; a blank label is the only validation failure (400). The token itself needs no input.
- The GET response is shaped by an explicit Prisma `select` (not a post-fetch strip), so `tokenHash` is structurally unreachable by the client — defense beyond "we didn't render it".
- The settings page intentionally omits the `role !== "admin"` redirect the users/libraries pages carry: tokens are per-user, so every signed-in account manages its own.
- Token generation/hashing matches 02-01's shape byte-for-byte (`randomBytes(32).base64url` mint, `sha256` hex store) so a token minted here authenticates through the existing `authenticateOpds` guard with no contract drift.

## Deviations from Plan

None - plan executed exactly as written.

## TDD Gate Compliance

Task 1 is marked `tdd="true"`. Under the host/VM split the agent cannot run Vitest, so a genuine RED could not be observed in-agent; the failing test and its implementation were authored together and committed in a single `feat(02-02)` commit (`6c89d98`) rather than as separate `test`->`feat` commits. The RED/GREEN sequence is therefore satisfied at the host run, not in git history. On the host, the first `npm test -- opds-tokens` run is the GREEN gate; to observe RED explicitly, the implementation files can be stashed and the suite re-run before restoring. This is a host-run gate, not a plan deviation.

## Issues Encountered

None during authoring. (Several in-agent verification greps were blocked by the sandbox when patterns contained shell-significant characters such as `</>` and `.`; the assertions were confirmed from file contents and single-pattern greps instead. This is a tooling quirk, not a code issue.)

## Verified here vs pending host-run

**Source-verified in-agent (grep / source assertions only):**
- Both REST files exist; `src/app/api/opds-tokens/route.ts` references `getCurrentUserId`; the `findMany` block does not select `tokenHash`.
- `src/app/api/opds-tokens/[id]/route.ts` returns `status: 404` on the ownership/unknown path, mirroring `notes/[id]`.
- No `console.*` anywhere under `src/app/api/opds-tokens/` (token/hash never logged).
- `src/app/settings/tokens/page.tsx` renders `<TokenManager />` and carries no `role !== "admin"` gate.
- `src/components/TokenManager.tsx` fetches `/api/opds-tokens` and uses `navigator.clipboard` with the "you won't see it again" note.
- `src/components/LibraryHeader.tsx` links to `/settings/tokens` at line 109, outside the `isAdmin` block that closes at line 108.
- The privacy pre-commit hook ran on both task commits and reported "no leaks found".

**Pending host-run gates (host/VM split — NOT run, NOT claimed to pass):**
The agent environment cannot run Prisma, npm, or the TypeScript compiler. This plan's code references `prisma.opdsToken`, whose TS types only exist after the host generates the client — expected and fine. This plan depends on the **02-01 host gate** (`npx prisma migrate dev --name opds_tokens`) having run, because `tests/opds-tokens.test.ts` applies the committed migrations (including `opds_tokens`) to its temp DB. On the host, in repo root, run in order:
1. `npx prisma migrate dev --name opds_tokens` — if not already run from 02-01. Generates + applies the migration and regenerates the Prisma client (the OpdsToken table the token test seeds against).
2. `npx tsc --noEmit` — expect clean (first run where `prisma.opdsToken` types exist for these files).
3. `npm test -- opds-tokens` — expect `tests/opds-tokens.test.ts` green: mint returns plaintext once + stores the hash, list omits token/hash, cross-user revoke 404 + row survives, signed-out 401s. (Also still pending from Phase 1: `npm install -D vitest@^4 vite-tsconfig-paths@^6` if not yet run.)
4. `npm run build` — expect clean.
5. Manual smoke: sign in as a non-admin, open `/settings/tokens`, mint a labelled token, see it once with a copy button + "you won't see it again" warning, see it in the list (no raw token), revoke it; confirm the nav link is visible to non-admins.

No host command above has been run; none is claimed to have passed. Agent-side acceptance = source assertions only.

## Known Stubs

None. The mint/list/revoke REST, the copy-once UI, and the nav link are fully wired against the contract and the 02-01 token storage. No placeholder data or empty-state fakes.

## Threat Flags

None. The plan's `<threat_model>` (T-02-06 IDOR, T-02-07/08 disclosure, T-02-09 spoofing) covers every surface introduced here, and each mitigation is present in source: ownership 404 on revoke, explicit `select` excluding the hash, sha256-only at rest with no logging, and `getCurrentUserId` gating all three endpoints.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- The human-facing half of OPDS-01 (credential source) and the copy-once / hashed-at-rest conformance points of OPDS-04 are authored. Together with 02-01 (the server-side guard), a user can now mint a token in the UI and an OPDS client can authenticate with it end-to-end — pending the single host run that generates the Prisma client and runs the suites.
- Blocker carried forward: the 02-01 host gate (`prisma migrate dev --name opds_tokens`, then `tsc`/`test`/`build`) must run before Phase 02 verification; this plan's test suite shares that migration.

## Self-Check: PASSED

- Files created exist: `src/app/api/opds-tokens/route.ts`, `src/app/api/opds-tokens/[id]/route.ts`, `src/app/settings/tokens/page.tsx`, `src/components/TokenManager.tsx`, `tests/opds-tokens.test.ts` — confirmed.
- Commits `6c89d98`, `2c3a6d6` exist in `git log`.
- Task 1 + Task 2 source-verification greps return OK (see Verified-here section).

---
*Phase: 02-opds-per-user-authentication*
*Completed: 2026-05-30*
