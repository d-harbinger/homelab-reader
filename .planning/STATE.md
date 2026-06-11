---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
status: executing
stopped_at: "Completed 03-02-PLAN.md (streaming book-file download with HTTP Range — 206/200/416 via createReadStream, RFC 7233 suffix-clamp; session-gated GET /api/scan/failures basename-only + dismissible FailedImportsBanner on the library page; tests/scanner.test.ts covering scanFile branches A/B/C + malformed→FailedImport against a real ephemeral SQLite DB, with committed fixtures). Source-asserted; host-run gates (prisma generate, tsc, npm test scanner suite, build, curl Range 206/416/Accept-Ranges, signed-out 401 on failures) pending."
last_updated: "2026-06-11T05:48:00Z"
last_activity: 2026-06-11
progress:
  total_phases: 3
  completed_phases: 2
  total_plans: 6
  completed_plans: 6
  percent: 100
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-05-31)

**Core value:** Point the server at a folder of books and every device — PCs in the browser, phones via android-reader/OPDS — reads the same library, with each person's notes, highlights, and progress kept private to them.
**Current focus:** Phase 03 — resource-safety-robustness

## Current Position

Phase: 03 (resource-safety-robustness) — EXECUTING (both plans authored in source)
Plan: 03-02 of 2 (streaming Range download + failed-import surface + scanner branch tests)
Status: Plan 03-02 complete in source. file route streams via createReadStream with full HTTP Range semantics (206 + Content-Range/Content-Length, 200 full + Accept-Ranges, 416 only on start>=size/start>end, RFC 7233 suffix-clamp); GET /api/scan/failures is session-gated and returns basename-only (no full path leak); FailedImportsBanner is mounted on the library page below the header; tests/scanner.test.ts drives scanFile against a real ephemeral SQLite DB covering branch A (hash-match moved), B (same-path different valid bytes via valid2.epub), C (new file) + malformed→FailedImport, with small committed fixtures. Awaits host-run gate (prisma generate, tsc, npm test for the scanner suite, build, curl Range 206/416/Accept-Ranges, signed-out 401 on failures). ROBUST-03/ROBUST-05(full)/TEST-03 done in source.

**Verify update 2026-06-11:** the in-VM gates are now green (VMM/libvirt dev box — builds/tests run in-VM, no longer host-only), re-run on top of Fable's latest (`2a9bf2f` SQL folder-filter fix, atop the `/api/fs` jailing `6309b30`). `prisma generate` (client v6.19.3), `tsc --noEmit`, `npm run lint` (0/0), `npx vitest run` (**18 files / 142 tests passed as of `2a9bf2f`** — covers scanner, opds-auth, opds-tokens, authz-gates, isolation, fs-route jail, folder-filter), and `npm run build` all pass. Remaining gates are live-instance behavioral only: curl Range 206/200/416 + `Accept-Ranges`, and signed-out `401` on `GET /api/scan/failures` + the failed-import banner — to be confirmed during the docker dogfood run.
Last activity: 2026-06-11

Progress: [██████████] 100% (source + in-VM gates verified 2026-06-11; only live-instance behavioral checks open)

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
| Phase 03 P01 | 2 min | 2 tasks | 10 files |
| Phase 03 P02 | 3 min | 3 tasks | 9 files |

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
- OPDS token mint reuses the 02-01 shape: randomBytes(32).toString("base64url") minted, sha256 hex stored; plaintext returned ONCE by POST, never by GET (explicit Prisma select excludes tokenHash), revoke uses notes/[id]-style ownership 404.
- /settings/tokens is per-user (NOT admin-gated); its nav link sits outside the LibraryHeader isAdmin block so every signed-in user can reach it.
- Concurrency cap = 4 around the per-event watcher dispatch (bounds the cold-start fan-out; hash-first idempotency keeps steady-state cheap). In-house createLimiter promise semaphore, NOT p-limit (no new dependency).
- applySqlitePragmas() applies WAL + busy_timeout=5000 each wrapped (a PRAGMA failure warns, never crashes boot); called from instrumentation register() BEFORE seed/startWatcher. connection_limit=1 lives on DATABASE_URL (.env.example + docs/DEPLOYMENT.md, placeholder paths only), not in code.
- PDF read-once: pdf.ts reads the file once; pdfjs metadata gets the Uint8Array view, renderFirstPageCover takes a SEPARATE Buffer.from copy (pdfjs neuters its copy). pdf-to-img accepts a Buffer directly; cover-render failure stays non-fatal.
- FailedImport.error truncated to 500 chars (T-03-04 info-disclosure mitigation; full path stays server-side, basename-only surfacing deferred to Plan 03-02). Hand-written 20260601000000_failed_imports migration (no host migrate dev), committed with the schema. record on extract throw, clear on successful scan + on unlink.
- File route streams via createReadStream→Readable.toWeb (no whole-file buffer). Range parsed defensively (clamp/validate before stream): 206 + Content-Range/Content-Length on a valid single range; 416 ONLY on start>=size or start>end; suffix bytes=-n with n>=size clamps to the full file (RFC 7233 / W-3); multi-range/malformed falls back to a full 200. Accept-Ranges on both 200 and 206; path.resolve escape defense preserved.
- /api/scan/failures privacy verified by RESPONSE SHAPE (emits id/name/reason/format/failedAt, no filePath key), not a blanket grep — the route must read filePath to compute path.basename (plan-check W-2).
- Scanner branch B test uses a SECOND distinct fixture (valid2.epub) so the in-place overwrite differs in bytes; identical bytes would hit hash-match branch A instead (plan-check W-1). Malformed test asserts extractEpub throws AND replicates the watcher boundary (recordFailedImport) — scanFile itself does not record. EPUB/PDF fixtures minted with a hand-rolled store-only ZIP writer (no archiver dep; yauzl reads store-only).

### Pending Todos

- **✅ IN-VM GATES CLOSED — 2026-06-11 (supersedes the static/typecheck/test/build steps of every gate below):** run in repo root on the VMM/libvirt dev box (in-VM execution is valid now; the host/VM "can't build here" constraint is stale). Results: `npm run db:generate` → Prisma Client v6.19.3 ✓ · `npx tsc --noEmit` → clean ✓ · `npm run lint` → 0 warnings / 0 errors ✓ · `npx vitest run` → **18 files / 142 tests passed (as of `2a9bf2f`)** ✓ (the full suite — scanner branch A/B/C + malformed, opds-auth, opds-tokens, authz-gates, isolation, fs-route jail, folder-filter — so the `npm test` step of the 01/02-01/02-02/03-01/03-02 gates is satisfied) · `npm run build` → compiled clean, all routes ✓. **Still open across the board:** only the live-instance *behavioral* checks that need a running server — curl Range `206`/`200`/`416` + `Accept-Ranges`, signed-out `401` on `GET /api/scan/failures` + the failed-import banner, OPDS `401`→`200` curl smoke, and the concurrent-save/no-`SQLITE_BUSY` + RSS observations. These are folded into the docker dogfood run (`docker compose up -d --build` on the host, pointed at the real library).

- **HOST-RUN GATE — Plan 03-02 (blocks Phase 03 verify):** the streaming Range route, the failures endpoint + banner, and the scanner suite are authored-but-unrun. `tests/scanner.test.ts` runs `prisma migrate deploy` against a temp DB (applies the committed `20260601000000_failed_imports` migration) and uses `prisma.failedImport`, so it shares the Plan 03-01 generate gate. On the host, in repo root, run in order:
  1. `npx prisma generate` (so `prisma.failedImport` types exist for the route + tests).
  2. `npx tsc --noEmit` — expect clean.
  3. `npm test` — expect `tests/scanner.test.ts` green: branch A (hash-match moved → path updates, no dup), branch B (same-path different valid bytes → same Book.id, re-extracted), branch C (new EPUB/PDF → create), malformed (corrupt.epub → extractEpub throws, FailedImport row, no Book), and the clear-on-success case.
  4. `npm run build` — expect clean.
  5. Range behavioral (curl): `curl -I .../api/books/<id>/file` → `Accept-Ranges: bytes`; `curl -r 0-1023 ...` → 206 + `Content-Range: bytes 0-1023/<size>` + 1024 bytes; out-of-range start → 416 + `Content-Range: bytes */<size>`; a short-file suffix `-99999999` → full file (not 416); RSS flat downloading a large book.
  6. Signed-out `GET /api/scan/failures` → 401; with a FailedImport row present, the library page shows the banner with the file basename (not a full path) + a dismiss button.
  - No host command above was run in-agent; none is claimed to pass. Agent-side acceptance = source assertions + fixture sanity (yauzl confirmed valid/valid2 parse with distinct titles and corrupt.epub throws).

- **HOST-RUN GATE — Plan 03-01 (blocks Phase 03 verify):** the FailedImport recording side references `prisma.failedImport`, whose TS types and table exist only after the host generates the client + applies the hand-written migration. On the host, in repo root, run in order:
  1. `npx prisma generate` then `npx prisma migrate deploy` — applies `prisma/migrations/20260601000000_failed_imports/` and regenerates the client so `prisma.failedImport` exists. (No `migrate dev` needed; the migration is hand-written.)
  2. `npx tsc --noEmit` — first run where `prisma.failedImport` types exist; expect clean.
  3. `npm test` — expect green (scanner branch + FailedImport tests land in Plan 03-02/TEST-03).
  4. `npm run build` — expect clean.
  5. Behavioral: under concurrent reader saves + an active scan, no `SQLITE_BUSY` / "database is locked"; a large cold-start import does not spike RSS unbounded; dropping a deliberately-corrupt EPUB creates a `FailedImport` row (not a silent drop); replacing it with a valid file clears the row.
  - No host command above was run in-agent; none is claimed to pass. Agent-side acceptance = source assertions only.

- **HOST-RUN GATE — Plan 02-02 (blocks Phase 02 verify; shares the 02-01 migration):** the token-management REST + copy-once UI are authored-but-unrun and reference `prisma.opdsToken`. `tests/opds-tokens.test.ts` applies the committed migrations (incl. `opds_tokens`) to a temp DB, so it depends on the 02-01 `prisma migrate dev --name opds_tokens` having run. On the host, in repo root:
  1. `npx prisma migrate dev --name opds_tokens` (if not already run from 02-01) — generates/applies the migration + regenerates the client.
  2. `npx tsc --noEmit` — expect clean.
  3. `npm test -- opds-tokens` — expect green: mint-once + hash stored, list omits token/hash, cross-user revoke 404 + row survives, signed-out 401s.
  4. `npm run build` — expect clean.
  5. Smoke: sign in as a non-admin, open `/settings/tokens`, mint a labelled token, see it once with copy + "won't see again" warning, see it in the list (no raw token), revoke it; confirm the nav link shows for non-admins.
  - No host command above was run in-agent; none is claimed to pass. Agent-side acceptance = source assertions only.

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
| Security | Confine `/api/fs` browse root to mounted volumes | ✅ Shipped 2026-06-11 (`6309b30` — jailed to configured root + uniform errors + fs-route test suite) | Milestone init |
| Sync | Per-user data export / backup API | Deferred (v2) | Milestone init |
| Scope | Per-user library scoping | Out of scope | Milestone init |
| Refactor | EPUB reader refactor (`EpubReader.tsx`) | Out of scope | Milestone init |
| Infra | Postgres migration | Out of scope | Milestone init |

## Session Continuity

Last session: 2026-05-30
Stopped at: Completed 03-02-PLAN.md (streaming book-file download with HTTP Range — 206/200/416 via createReadStream + RFC 7233 suffix-clamp; session-gated GET /api/scan/failures basename-only + dismissible FailedImportsBanner on the library page; tests/scanner.test.ts covering scanFile branches A/B/C + malformed→FailedImport against a real ephemeral SQLite DB, with committed fixtures). Source-asserted; host-run gates (prisma generate, tsc, npm test scanner suite, build, curl Range 206/416/Accept-Ranges, signed-out 401 on failures) pending. Phase 03 plans both authored; phase verify awaits the host gates above.
Resume file: .planning/phases/03-resource-safety-robustness/03-02-SUMMARY.md
