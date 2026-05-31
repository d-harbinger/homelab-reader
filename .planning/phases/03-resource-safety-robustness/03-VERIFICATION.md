---
phase: 03-resource-safety-robustness
verified: 2026-05-31T04:07:20Z
status: human_needed
score: 6/6
overrides_applied: 0
human_verification:
  - test: "Run npx prisma generate on the host (so prisma.failedImport TS types are generated), then npx tsc --noEmit"
    expected: "Zero TypeScript errors; prisma.failedImport resolves cleanly"
    why_human: "Host/VM split — prisma generate cannot run in-agent; TS types for FailedImport model do not exist until generated"
  - test: "Run npm test on the host"
    expected: "tests/scanner.test.ts passes — all 8 cases green: branches A/B/C (×2), malformed→FailedImport, clear-on-success, removeFileFromLibrary"
    why_human: "Host/VM split — vitest cannot run in-agent"
  - test: "Run npm run build on the host"
    expected: "Clean build (no TS or webpack errors)"
    why_human: "Host/VM split — build cannot run in-agent"
  - test: "curl Range checks against a running instance: curl -r 0-99 -i .../api/books/<id>/file → 206 + Content-Range: bytes 0-99/<size>; curl -r 1000000000- -i ... → 416 + Content-Range: bytes */<size>; curl -i ... (no Range) → 200 + Accept-Ranges: bytes"
    expected: "206 for satisfiable range, 416 for oversized start, 200 full file when no header — consistent with RFC 7233 implementation in route.ts"
    why_human: "Behavioral HTTP check requires a running server on the host side"
  - test: "Drop a corrupt ZIP file (e.g. a .txt renamed to .epub) into a watched library folder; wait for the scanner to process it; check the library page"
    expected: "The FailedImportsBanner appears with the file's basename and a non-empty error reason; the book does NOT appear in the library grid"
    why_human: "End-to-end watcher→DB→UI path requires a running instance"
  - test: "Sign out and GET /api/scan/failures"
    expected: "401 response"
    why_human: "Auth behavior requires a running instance"
  - test: "Under a moderate concurrent-reader + active-scan workload, watch server logs for SQLITE_BUSY or 'database is locked' errors"
    expected: "No such errors; WAL + busy_timeout absorbs contention"
    why_human: "Concurrency behavior cannot be verified statically"
---

# Phase 03: Resource Safety & Robustness — Verification Report

**Phase Goal:** The container holds up under concurrent readers + the background scanner without DB-lock errors, memory spikes, or silently-dropped books — and the scanner's reconcile branches are covered by tests.
**Verified:** 2026-05-31T04:07:20Z
**Status:** human_needed
**Re-verification:** No — initial verification

---

## Goal Achievement

All six success criteria are source-verified. The code and committed artifacts are
correct and complete; no deliverable is missing or stubbed. Status is `human_needed`
because the host/VM split blocks the behavioral checks that only a running instance
(and host-side toolchain) can provide.

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | ROBUST-01: SQLite runs WAL + busy_timeout + single writer connection | VERIFIED | `applySqlitePragmas()` at `src/lib/prisma.ts:27-42` runs `PRAGMA journal_mode=WAL` + `PRAGMA busy_timeout=5000`; called at `src/instrumentation.ts:18` before watcher (:22); `connection_limit=1` in `.env.example:12` |
| 2 | ROBUST-02: cold-start scan goes through a concurrency-limited queue | VERIFIED | `src/lib/concurrency.ts` exports `createLimiter(max)` (FIFO semaphore, no dep); `watcher.ts:27` constructs `createLimiter(4)`; `limiter.run(...)` wraps dispatch at lines 136, 154, 167 — all 3 handlers covered |
| 3 | ROBUST-03: book download streams with Range support (206/200/416, Accept-Ranges) | VERIFIED | `src/app/api/books/[id]/file/route.ts` uses `createReadStream` + `Readable.toWeb`; `parseRange()` returns satisfiable range/unsatisfiable/"null"; 206 at line 149, 416 at line 136, 200 at line 161; `Accept-Ranges: bytes` in `baseHeaders:129` on all responses |
| 4 | ROBUST-04: PDF import reads each file once for metadata + cover | VERIFIED | `src/lib/scanner/pdf.ts:28` has one `fs.readFile`; metadata parser receives `Uint8Array` view (line 32); cover renderer receives `Buffer.from(buffer)` copy at line 68 — no second file open; comment at line 27 confirms ROBUST-04 intent |
| 5 | ROBUST-05: malformed EPUB/PDF surfaces a failed-import signal in the UI | VERIFIED | `FailedImport` model in `schema.prisma:177-183`; `migration.sql` committed at `prisma/migrations/20260601000000_failed_imports/`; `recordFailedImport`/`clearFailedImport` in `failed-imports.ts`; wired in `watcher.ts` add/change/unlink handlers; `GET /api/scan/failures` at `src/app/api/scan/failures/route.ts`; `FailedImportsBanner` renders in `src/app/page.tsx:84` |
| 6 | TEST-03: scanner tests cover 3 scanFile branches + malformed archive, with fixtures | VERIFIED | `tests/scanner.test.ts` — Branch A (hash-match move, line 92), Branch B (same-path content-changed using `valid2.epub`, line 111), Branch C (new PDF + new EPUB, lines 135/147), malformed→FailedImport (line 159), clear-on-success (line 190), removeFileFromLibrary (line 214); all 4 fixtures present in `tests/fixtures/` |

**Score:** 6/6 truths source-verified

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/lib/prisma.ts` | `applySqlitePragmas()` with WAL + busy_timeout | VERIFIED | Lines 27-42; `PRAGMA journal_mode=WAL` + `PRAGMA busy_timeout=5000` |
| `src/instrumentation.ts` | Calls `applySqlitePragmas` before `startWatcher` | VERIFIED | Line 18 (pragmas) precedes line 22 (watcher) |
| `.env.example` | `DATABASE_URL` with `connection_limit=1` | VERIFIED | Line 12; explanatory comment lines 7-11 |
| `src/lib/concurrency.ts` | In-house FIFO semaphore, no new dep | VERIFIED | 47-line implementation; no new import/dep |
| `src/lib/scanner/watcher.ts` | `limiter.run()` wraps all 3 event handlers | VERIFIED | 3 occurrences confirmed via grep |
| `src/lib/scanner/pdf.ts` | Single `fs.readFile`; buffer copy to cover renderer | VERIFIED | One `readFile` at line 28; `Buffer.from(buffer)` copy at line 68 |
| `prisma/schema.prisma` | `model FailedImport` with filePath UNIQUE | VERIFIED | Lines 177-183; `filePath @unique` present |
| `prisma/migrations/20260601000000_failed_imports/migration.sql` | `CREATE TABLE FailedImport` + UNIQUE INDEX | VERIFIED | Both DDL statements present; matches schema |
| `src/lib/scanner/failed-imports.ts` | `recordFailedImport` (upsert) + `clearFailedImport` (deleteMany) | VERIFIED | Both exported functions; upsert by filePath; error truncated to 500 chars |
| `src/app/api/books/[id]/file/route.ts` | `createReadStream` + Range (206/200/416) + `Accept-Ranges` | VERIFIED | All present; full defensive `parseRange()` implementation |
| `src/app/api/scan/failures/route.ts` | Session-gated; returns basename only | VERIFIED | `getCurrentUser()` guard; `path.basename(row.filePath)` — no `filePath` key in response |
| `src/components/FailedImportsBanner.tsx` | SWR-fetches `/api/scan/failures`; renders on failures | VERIFIED | `useSWR` at line 26; renders when `failures.length > 0`; dismiss is local state |
| `src/app/page.tsx` | `<FailedImportsBanner />` mounted on library page | VERIFIED | Imported at line 6; rendered at line 84 |
| `tests/scanner.test.ts` | Covers branches A/B/C + malformed + removeFileFromLibrary | VERIFIED | 8 `it()` cases covering all required branches |
| `tests/fixtures/valid.epub` | Real EPUB ZIP, title "Valid Fixture One" | VERIFIED | 1762 bytes; distinct from valid2 |
| `tests/fixtures/valid2.epub` | Second EPUB with different bytes/title, for Branch B | VERIFIED | 1772 bytes; title "Valid Fixture Two" per test assertion at line 119 |
| `tests/fixtures/valid.pdf` | Real single-page PDF | VERIFIED | 588 bytes |
| `tests/fixtures/corrupt.epub` | Non-ZIP blob that makes extractEpub throw | VERIFIED | 50 bytes; non-ZIP per yauzl check documented in SUMMARY |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `instrumentation.ts` | `prisma.ts:applySqlitePragmas` | `await applySqlitePragmas()` at line 18 | WIRED | Called before seed (line 20) and watcher (line 22) |
| `watcher.ts` | `concurrency.ts:createLimiter` | `import { createLimiter } from "@/lib/concurrency"` | WIRED | Module-level `limiter = createLimiter(4)` at line 27 |
| `watcher.ts` | `scanner/index.ts:scanFile` | `limiter.run(() => scanFile(filePath))` | WIRED | In add (line 136), change (line 154), unlink (line 167) |
| `watcher.ts` | `failed-imports.ts:recordFailedImport` | `await recordFailedImport(...)` in catch blocks | WIRED | add catch (line 144), change catch (line 158) |
| `watcher.ts` | `failed-imports.ts:clearFailedImport` | `await clearFailedImport(filePath)` after scanFile success | WIRED | add (line 139), change (line 155), unlink (line 170) |
| `pdf.ts:extractPdf` | cover renderer | `renderFirstPageCover(Buffer.from(buffer))` at line 68 | WIRED | Passes buffer copy, not filePath — single read confirmed |
| `failures/route.ts` | `prisma.failedImport.findMany` | Direct Prisma query at line 19 | WIRED | Returns real DB rows; response shapes to basename-only |
| `FailedImportsBanner.tsx` | `/api/scan/failures` | `useSWR("/api/scan/failures", fetcher)` at line 26 | WIRED | 15s refresh; renders `failures` array from response |
| `page.tsx` | `FailedImportsBanner` | `<FailedImportsBanner />` at line 84 | WIRED | Imported at line 6 |
| `file/route.ts` | `createReadStream` | `createReadStream(filePath, { start, end })` for 206; `createReadStream(filePath)` for 200 | WIRED | Streamed via `Readable.toWeb`; never `fs.readFile` |

---

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|--------------|--------|-------------------|--------|
| `FailedImportsBanner.tsx` | `data.failures` | `useSWR → /api/scan/failures → prisma.failedImport.findMany()` | Yes — real DB query returning all FailedImport rows | FLOWING |
| `failures/route.ts` | `rows` | `prisma.failedImport.findMany({ orderBy: { createdAt: "desc" } })` | Yes — live DB query | FLOWING |
| `file/route.ts` | file bytes | `createReadStream(filePath, { start, end })` — disk read | Yes — streamed from disk | FLOWING |

---

### Behavioral Spot-Checks

Step 7b: SKIPPED — no runnable entry point in-agent (host/VM split). Behavioral checks routed to Human Verification Required section.

---

### Probe Execution

Step 7c: No `scripts/*/tests/probe-*.sh` probes found for this phase. SKIPPED.

---

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| ROBUST-01 | 03-01 | WAL + busy_timeout + connection_limit=1 | SATISFIED | `applySqlitePragmas` in prisma.ts; `connection_limit=1` in .env.example |
| ROBUST-02 | 03-01 | Concurrency-limited cold-start scan | SATISFIED | `createLimiter(4)` + `limiter.run` in watcher.ts |
| ROBUST-03 | 03-02 | Streaming Range-aware book download | SATISFIED | `createReadStream` + full Range impl in file/route.ts |
| ROBUST-04 | 03-01 | PDF reads file once for metadata + cover | SATISFIED | Single `fs.readFile` in pdf.ts; buffer copy to cover renderer |
| ROBUST-05 | 03-01 + 03-02 | Malformed file surfaces in UI (not silent drop) | SATISFIED | FailedImport model + migration + watcher wiring + API endpoint + banner |
| TEST-03 | 03-02 | Scanner branch + malformed test coverage | SATISFIED | 8 test cases in scanner.test.ts; 4 committed fixtures |

---

### Anti-Patterns Found

Scanned all files touched by this phase for TBD/FIXME/XXX/TODO/HACK/PLACEHOLDER.

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `src/lib/scanner/pdf.ts` | 19, 127, 139 | "placeholder" | Info | Comment-only — describing the UI format-badge fallback behavior. No return-value stub; these are explanatory prose. Not a code issue. |

No blockers or warnings found. The "placeholder" occurrences are comment text describing a planned future cover-render improvement, not stubs in return paths.

---

### Human Verification Required

#### 1. Prisma generate + TypeScript typecheck

**Test:** On the host, run `npx prisma generate` then `npx tsc --noEmit`
**Expected:** Zero TypeScript errors. `prisma.failedImport` resolves to the generated TS type from the `FailedImport` model. Any prior "Property 'failedImport' does not exist on type PrismaClient" errors disappear.
**Why human:** The FailedImport model is in schema.prisma and the migration SQL is committed, but Prisma's generated TypeScript client does not exist until `prisma generate` runs on the host. The type check cannot pass without it.

#### 2. Test suite

**Test:** On the host, run `npm test`
**Expected:** All 8 cases in `tests/scanner.test.ts` pass (branches A/B/C ×2, malformed→FailedImport, clear-on-success, removeFileFromLibrary). The suite calls `prisma migrate deploy` in `beforeAll`, which applies the committed `20260601000000_failed_imports` migration to a temp SQLite file.
**Why human:** Host/VM split — vitest cannot run in-agent.

#### 3. Build

**Test:** On the host, run `npm run build`
**Expected:** Clean webpack build with no TypeScript or module-resolution errors.
**Why human:** Host/VM split — build cannot run in-agent.

#### 4. HTTP Range behavior (curl)

**Test:** Against a running instance, run the following curl commands against a book file endpoint:
- `curl -I .../api/books/<id>/file` — check for `Accept-Ranges: bytes`
- `curl -r 0-99 -i .../api/books/<id>/file` — satisfiable range
- `curl -r 1000000000- -i .../api/books/<id>/file` — oversized start (past EOF)
- `curl -r -5 -i .../api/books/<id>/file` where file is < 5 bytes — suffix >= size
**Expected:**
- HEAD: `Accept-Ranges: bytes` present
- `0-99`: `206 Partial Content`, `Content-Range: bytes 0-99/<size>`, body is 100 bytes
- oversized start: `416 Range Not Satisfiable`, `Content-Range: bytes */<size>`
- suffix >= size: full file returned (200 or 206 clamped to whole file per RFC 7233 §W-3)
**Why human:** HTTP behavior requires a running server on the host side.

#### 5. Failed-import banner (end-to-end)

**Test:** Drop a corrupt file (e.g. a `.txt` renamed to `.epub`) into a watched library folder. Wait for the scanner to process it (~2s stabilityThreshold). Reload the library page.
**Expected:** The amber `FailedImportsBanner` appears listing the file's basename (not full path) and an error reason. The file does NOT appear in the library grid. Replacing with a valid EPUB clears the banner on the next poll (within 15s).
**Why human:** Requires a running instance with an active watcher and a real library folder.

#### 6. Auth gate on /api/scan/failures

**Test:** While signed out, send `GET /api/scan/failures`
**Expected:** `401 Unauthorized` response
**Why human:** Auth behavior requires a running instance with NextAuth session.

#### 7. Concurrency under load (SQLITE_BUSY check)

**Test:** With 5+ concurrent readers saving notes/progress while the scanner is processing a batch of new books, watch server logs for `SQLITE_BUSY` or "database is locked" errors.
**Expected:** No such errors. WAL mode allows concurrent readers alongside the single writer; `busy_timeout=5000` absorbs brief contention.
**Why human:** Cannot simulate concurrent workload statically; requires a real running instance.

---

### Gaps Summary

None. All six success criteria are source-verified. The code is complete and correctly wired. The only outstanding items are behavioral checks that require host-side tooling (`prisma generate`, `tsc`, `npm test`, `npm run build`) and a running instance (Range curl checks, banner end-to-end, auth gate, concurrency load). These are normal host-pending items for a host/VM split environment — not code deficiencies.

---

_Verified: 2026-05-31T04:07:20Z_
_Verifier: Claude (gsd-verifier)_
