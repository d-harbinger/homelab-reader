---
phase: 03-resource-safety-robustness
plan: 01
subsystem: backend-robustness
tags: [sqlite, wal, concurrency, scanner, pdf, failed-import, prisma]
requires:
  - "Prisma + SQLite singleton (src/lib/prisma.ts)"
  - "instrumentation register() boot hook"
  - "chokidar watcher dispatch (src/lib/scanner/watcher.ts)"
provides:
  - "applySqlitePragmas() — WAL + busy_timeout at boot"
  - "createLimiter(max) in-house promise semaphore (src/lib/concurrency.ts)"
  - "FailedImport model + recordFailedImport/clearFailedImport helpers"
  - "PDF read-once extraction (single fs.readFile feeds metadata + cover)"
affects:
  - "Plan 03-02 (API/UI surface for failed imports builds on the FailedImport model)"
  - "Any reader + background-writer workload (no longer locks under WAL)"
tech-stack:
  added: []
  patterns:
    - "In-house promise semaphore instead of p-limit (no new dependency)"
    - "Hand-written fixed-timestamp Prisma migration (host migrate dev unavailable)"
    - "PRAGMA-per-statement wrapped so a failure warns instead of crashing boot"
key-files:
  created:
    - src/lib/concurrency.ts
    - src/lib/scanner/failed-imports.ts
    - prisma/migrations/20260601000000_failed_imports/migration.sql
    - docs/DEPLOYMENT.md
  modified:
    - src/lib/prisma.ts
    - src/instrumentation.ts
    - .env.example
    - src/lib/scanner/watcher.ts
    - src/lib/scanner/pdf.ts
    - prisma/schema.prisma
decisions:
  - "Concurrency cap = 4: bounds the cold-start fan-out while still overlapping I/O-bound extracts"
  - "Error message truncated to 500 chars in recordFailedImport (T-03-04 information-disclosure mitigation; full path stays server-side)"
  - "connection_limit=1 lives on DATABASE_URL (.env.example + DEPLOYMENT.md), not in code"
  - "Cover renderer gets a separate Buffer.from copy because pdfjs neuters the metadata view"
metrics:
  duration: "~2 min"
  completed: "2026-05-31"
  tasks: 2
  files_created: 4
  files_modified: 6
---

# Phase 3 Plan 01: Resource Safety & Robustness (SQLite/Concurrency/PDF/FailedImport) Summary

SQLite gains WAL + a busy timeout at boot before the watcher writes, the
cold-start scan is capped by an in-house semaphore (cap 4, no new dependency),
each PDF is read from disk exactly once for both metadata and cover, and a
malformed book now records a visible FailedImport row instead of silently
vanishing.

## What Was Built

### Task 1 — SQLite tuning (ROBUST-01) + concurrency limiter (ROBUST-02) — commit `79f39ce`

- `applySqlitePragmas()` in `src/lib/prisma.ts` runs `PRAGMA journal_mode=WAL`
  and `PRAGMA busy_timeout=5000` via `prisma.$executeRawUnsafe`, each wrapped so
  a non-SQLite datasource / read-only mount / PRAGMA failure logs a warning
  rather than crashing boot.
- `src/instrumentation.ts` `register()` calls it inside the existing try, under
  the `NEXT_RUNTIME==="nodejs"` guard, BEFORE `seedFromBooksPath()` and
  `startWatcher()` (verified: lines 18 → 20 → 22).
- `.env.example` `DATABASE_URL` gains `?connection_limit=1` (placeholder path
  kept) with an explanatory comment; `docs/DEPLOYMENT.md` documents the same
  serialized-writer requirement for the Docker `/data` deployment using
  placeholder paths only.
- `src/lib/concurrency.ts` exports `createLimiter(max)` → `{ run<T>(fn) }`, a
  ~25-line FIFO promise semaphore (no `p-limit`, no dependency).
- `src/lib/scanner/watcher.ts` constructs one module-level `limiter =
  createLimiter(4)` and wraps the `scanFile`/`removeFileFromLibrary` dispatch in
  all three (add/change/unlink) handlers with `limiter.run(...)`. The existing
  per-handler try/catch, `isBookFile` guard, and `globalThis` watcher-state
  pattern are untouched.

### Task 2 — PDF read-once (ROBUST-04) + FailedImport recording (ROBUST-05) — commit `37b3df6`

- `src/lib/scanner/pdf.ts` reads the file once (`fs.readFile`). The metadata
  parser receives the `Uint8Array` view (pdfjs takes ownership/neuters it);
  `renderFirstPageCover` now accepts `bytes: Buffer | Uint8Array` and is handed
  a SEPARATE `Buffer.from(buffer)` copy, so it no longer re-opens the path.
  `pdf-to-img`'s `pdf()` accepts a buffer directly (confirmed via its types).
  Cover-render failure stays non-fatal (unchanged try/catch returning
  undefined). `PdfExtraction` shape unchanged.
- `prisma/schema.prisma` gains `model FailedImport { id @id @default(cuid),
  filePath @unique, format, error, createdAt @default(now()) }`.
- `prisma/migrations/20260601000000_failed_imports/migration.sql` is
  hand-written, mirroring the `20260531000000_opds_tokens` shape (TEXT PRIMARY
  KEY, NOT NULL columns, `DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP`, separate
  `CREATE UNIQUE INDEX` on filePath). Committed together with the schema.
- `src/lib/scanner/failed-imports.ts` exports `recordFailedImport(filePath,
  format, err)` (upsert by filePath, error truncated to 500 chars) and
  `clearFailedImport(filePath)` (`deleteMany`, no-throw when absent).
- `src/lib/scanner/watcher.ts`: on a successful `scanFile` →
  `clearFailedImport`; on the add/change catch → `recordFailedImport` (with a
  nested catch so a recording failure only logs); on unlink → `clearFailedImport`.
  Format is derived from the file extension at the boundary
  (`formatFromExtension`), not a DB lookup.

## Source-Verified vs Pending Host-Run

This environment is a host/VM split: `npm install`, `npm test`, `npx tsc`,
`npm run build`, and `prisma migrate/generate` cannot run in-agent. None of the
host commands below were run; none is claimed to pass.

### Source-verified (agent-side acceptance)

- Task 1 automated grep: PASS — `applySqlitePragmas` in instrumentation;
  `journal_mode=WAL` + `busy_timeout` in prisma.ts; `connection_limit=1` in
  `.env.example`; `createLimiter` in concurrency.ts; `limiter.run` count = 3 in
  watcher.ts.
- Task 2 automated grep: PASS — `model FailedImport` in schema; `CREATE TABLE`
  + `filePath` in the migration; `recordFailedImport`/`clearFailedImport` in the
  helper and wired in the watcher; `renderFirstPageCover` present and
  `! grep "pdf(filePath"` (no re-open by path).
- Ordering confirmed: pragmas (instrumentation.ts:18) before seed (:20) and
  watcher (:22).
- Privacy pre-commit hook ran on both commits: "no leaks found".

### Pending host-run (behavioral — cannot run in-agent)

1. `npx prisma migrate dev` is NOT required for THIS migration (hand-written);
   on the host run `npx prisma generate` (and `prisma migrate deploy`) so
   `prisma.failedImport` types exist and the table is created. The 02-01/02-02
   `opds_tokens` host gate is still separately pending.
2. `npx tsc --noEmit` — first run where `prisma.failedImport` types exist;
   expect clean.
3. `npm test` — expect green (scanner branch tests land in Plan 03-02/TEST-03).
4. `npm run build` — expect clean.
5. Behavioral: under concurrent reader saves + an active scan, no `SQLITE_BUSY`
   / "database is locked"; a large cold-start import does not spike RSS
   unbounded; dropping a deliberately-corrupt EPUB creates a `FailedImport` row
   (not a silent drop); replacing it with a valid file clears the row.

## Deviations from Plan

None — plan executed exactly as written. One in-scope naming choice: the
watcher limiter variable is named `limiter` (not `scanLimiter`) so the plan's
literal `grep -c "limiter.run"` verification matches.

## Threat Surface

Implements the planned mitigations T-03-01 (WAL + busy_timeout +
connection_limit), T-03-02 (limiter cap 4), T-03-03 (PDF read-once), T-03-04
(truncated FailedImport.error, full path server-side). No new security-relevant
surface beyond the plan's threat model. T-03-SC holds: no new dependency added.

## Known Stubs

None. The FailedImport API/UI surface is intentionally deferred to Plan 03-02
(ROBUST-05 surfacing side) per the plan scope; the recording side wired here is
complete.

## Self-Check: PASSED

- Created files exist: src/lib/concurrency.ts, src/lib/scanner/failed-imports.ts,
  prisma/migrations/20260601000000_failed_imports/migration.sql, docs/DEPLOYMENT.md.
- Commits exist: 79f39ce (Task 1), 37b3df6 (Task 2).
