---
phase: 03-resource-safety-robustness
plan: 02
subsystem: download-streaming + failed-import-surface + scanner-tests
tags: [http-range, streaming, createReadStream, swr, failed-import, vitest, fixtures, privacy]
requires:
  - "FailedImport model + recordFailedImport/clearFailedImport (Plan 03-01)"
  - "getCurrentUser/authError + UnauthenticatedError (src/lib/current-user.ts)"
  - "scanFile 3-branch idempotency (src/lib/scanner/index.ts)"
  - "ephemeral-SQLite test seam (tests/helpers/test-db.ts, vi.mock @/lib/prisma)"
provides:
  - "Range-aware streaming book-file download (206/200/416, createReadStream)"
  - "GET /api/scan/failures — session-gated, basename-only failed-import list"
  - "FailedImportsBanner — dismissible library-page notice backed by the endpoint"
  - "tests/scanner.test.ts — scanFile branch coverage + malformed→FailedImport"
  - "tests/fixtures/{valid,valid2}.epub, valid.pdf, corrupt.epub"
affects:
  - "android-reader OPDS download (now gets Accept-Ranges + 206 for seekable fetch)"
  - "Library UI (a malformed book is now visible, not a silent drop)"
tech-stack:
  added: []
  patterns:
    - "Node createReadStream → Readable.toWeb for a streamed Response body"
    - "Defensive Range parse: clamp/validate offsets before createReadStream (never trust header math)"
    - "RFC 7233 suffix-range clamp (bytes=-n, n>=size → full file, not 416)"
    - "Response-shape privacy: read filePath server-side, emit path.basename only"
    - "Dependency-free store-only ZIP writer to mint real EPUB fixtures"
key-files:
  created:
    - src/app/api/scan/failures/route.ts
    - src/components/FailedImportsBanner.tsx
    - tests/scanner.test.ts
    - tests/fixtures/valid.epub
    - tests/fixtures/valid2.epub
    - tests/fixtures/valid.pdf
    - tests/fixtures/corrupt.epub
  modified:
    - src/app/api/books/[id]/file/route.ts
    - src/app/page.tsx
decisions:
  - "Suffix range bytes=-n with n>=size clamps to the full file (206/200), not 416 (RFC 7233 / W-3) — short-file safety for android-reader"
  - "416 returned ONLY when start>=size or start>end; multi-range / malformed header falls back to a full 200, never an error"
  - "Failures privacy verified by RESPONSE SHAPE (no filePath key emitted), not a blanket grep — the route must read filePath to compute basename (W-2)"
  - "Branch B test uses a SECOND distinct fixture (valid2.epub) so the overwrite differs in bytes — identical bytes would hit hash-match branch A (W-1)"
  - "Malformed case asserts extractEpub throws AND replicates the watcher boundary (recordFailedImport) — scanFile itself does not record; the watcher catch does"
  - "writeCover stubbed in the scanner suite so branch tests don't write into the prod cover-cache dir"
  - "Fixtures minted with a hand-rolled store-only ZIP writer (no archiver dependency); yauzl reads store-only zips"
metrics:
  duration: "~3 min"
  completed: "2026-05-30"
  tasks: 3
  files_created: 7
  files_modified: 2
---

# Phase 3 Plan 02: Streaming Download + Failed-Import Surface + Scanner Tests Summary

The book-file route now streams from disk with full HTTP Range support
(206/200/416, no whole-file buffering), failed imports surface as a dismissible
library banner backed by a session-gated basename-only endpoint, and the
scanner's three reconcile branches plus malformed-archive handling get their
first real-DB tests with committed fixtures.

## What Was Built

### Task 1 — Streaming file download with Range (ROBUST-03) — commit `05c1018`

- `src/app/api/books/[id]/file/route.ts` replaces the whole-file `fs.readFile`
  with `createReadStream` adapted to a web `ReadableStream` via
  `Readable.toWeb`. `fs.stat` supplies the size; a non-file or missing path
  still returns 404.
- `parseRange(header, size)` parses a single `bytes=` range defensively and
  returns one of: a clamped inclusive `{start, end}`, `"unsatisfiable"`, or
  `null` (full file). It validates every number (`Number.isInteger`, `>= 0`),
  rejects inverted/multi/malformed ranges, and never feeds unchecked header
  arithmetic to `createReadStream` (T-03-06).
- Range semantics:
  - Valid single range → **206** with `Content-Range: bytes <start>-<end>/<size>`
    and `Content-Length = end-start+1` (inclusive end).
  - **W-3 (RFC 7233):** a suffix `bytes=-n` with `n >= size` clamps to the whole
    file (`start=0`) rather than 416 — protects android-reader on short files.
  - Unsatisfiable (**start >= size**, or **start > end**, or a suffix of 0, or any
    range on a 0-byte file) → **416** with `Content-Range: bytes */<size>`.
  - No / unparseable / multi-range header → **200** full file.
- `Accept-Ranges: bytes` is sent on **both** 200 and 206. MIME map,
  `Content-Disposition: filename*` encoding, private `Cache-Control`, and the
  `path.resolve(book.filePath)` escape defense (T-03-08) are preserved.

### Task 2 — Failed-import surface: GET /api/scan/failures + banner (ROBUST-05 surface) — commit `47121e1`

- `src/app/api/scan/failures/route.ts`: session-gated GET. `getCurrentUser()` →
  `authError(new UnauthenticatedError())` (401) when signed out; a try/catch
  around the query routes typed errors through `authError`. Returns hand-shaped
  `{ failures: [{ id, name, reason, format, failedAt }] }` ordered
  `createdAt desc`. **`name` is `path.basename(row.filePath)` only** — the full
  filesystem path (a home-dir path on a homelab) never reaches the client
  (T-03-07). The response object emits **no `filePath` key** (W-2).
- `src/components/FailedImportsBanner.tsx` (`"use client"`): SWR-fetches
  `/api/scan/failures` (15s refresh), renders nothing when empty or dismissed,
  and otherwise shows a calm amber/zinc notice (`AlertTriangle`) listing each
  failure as `basename — reason` with a local-state dismiss (`X`). Tone and
  palette mirror `LibraryHeader`.
- `src/app/page.tsx` imports and renders `<FailedImportsBanner />` directly below
  `LibraryHeader` and above the Continue-reading `Section`.

### Task 3 — Scanner branch tests + fixtures (TEST-03) — commit `d9a5374`

- `tests/scanner.test.ts` mirrors the isolation suite's seam: a `vi.hoisted()`
  ephemeral `PrismaClient` bound to a temp SQLite file, injected via
  `vi.mock("@/lib/prisma")`, with committed migrations applied in `beforeAll`
  (`prisma migrate deploy`). `writeCover` is stubbed so branch tests don't write
  into the prod cover-cache dir. Fixtures are staged into a per-test temp library
  dir and `scanFile` is driven directly by absolute path — no chokidar.
  - **Branch A** (hash-match moved file): same bytes at a new path → the existing
    Book's `filePath` updates, `id` retained, no duplicate row.
  - **Branch B** (same path, different valid bytes): overwrite the path with
    `valid2.epub` → **same `Book.id`**, title re-extracted (`Valid Fixture One` →
    `Valid Fixture Two`), `fileHash` changed, no duplicate (W-1 — a distinct
    second fixture is what forces branch B instead of hash-match branch A).
  - **Branch C** (brand-new file): new PDF and new EPUB each create a Book with a
    non-empty extracted/fallback title.
  - **Malformed**: `extractEpub(corrupt.epub)` rejects; the watcher boundary is
    replicated (catch → `recordFailedImport`) → a `FailedImport` row exists for
    the path, **no Book** is created, and a later valid import + `clearFailedImport`
    removes the row.
  - **removeFileFromLibrary**: deletes the Book row for a removed path.
- Fixtures committed under `tests/fixtures/`: `valid.epub` / `valid2.epub` (real
  store-only EPUB zips with distinct titles/authors/language), `valid.pdf` (a
  hand-built single-page PDF), `corrupt.epub` (a non-zip blob so `extractEpub`
  throws). All byte-small (50 B – 1.8 KB).

## Source-Verified vs Pending Host-Run

Host/VM split: `npm install`, `npm test`, `npx tsc`, `npm run build`, and
`prisma generate/migrate` cannot run in-agent. None of the host commands below
were run; none is claimed to pass.

### Source-verified (agent-side acceptance)

- **Task 1 automated grep — PASS:** `createReadStream`, `Accept-Ranges`,
  `Content-Range`, `206|416`, `path.resolve` present; `fs.readFile` absent.
- **Task 2 — PASS:** `getCurrentUser` + `basename` in the route; banner self-name
  + `/api/scan/failures` fetch present; `FailedImportsBanner` mounted in
  `page.tsx`. **W-2 response-shape:** the only `filePath` occurrence is the
  server-side read `path.basename(row.filePath)`; the response object emits no
  `filePath` key.
- **Task 3 automated grep — PASS:** `tests/scanner.test.ts` exists, drives
  `scanFile`, asserts `FailedImport`, `describe/it` present; `valid.epub` +
  `corrupt.epub` committed. **W-1:** `valid2.epub` is the branch-B overwrite.
- **Fixture sanity (ran in-agent via yauzl):** `valid.epub`/`valid2.epub` parse
  with distinct titles ("Valid Fixture One"/"Valid Fixture Two") and contain
  `META-INF/container.xml` + `OEBPS/content.opf`; `corrupt.epub` makes yauzl
  throw ("End of central directory record signature not found"), so `extractEpub`
  will throw as the test asserts.
- Fixtures confirmed **not** gitignored (`git check-ignore` → exit 1).
- Privacy pre-commit hook ran on all three commits: "no leaks found".

### Pending host-run (behavioral — cannot run in-agent)

1. `npx prisma generate` (so `prisma.failedImport` types exist) — still the
   shared Plan 03-01 gate.
2. `npx tsc --noEmit` — expect clean.
3. `npm test` — expect `tests/scanner.test.ts` green (all branches +
   malformed→FailedImport against the ephemeral DB). The suite calls
   `prisma migrate deploy`, which applies the committed
   `20260601000000_failed_imports` migration.
4. `npm run build` — expect clean.
5. **Range behavioral (curl):**
   - `curl -I .../api/books/<id>/file` → `Accept-Ranges: bytes`.
   - `curl -r 0-1023 ...` → **206**, `Content-Range: bytes 0-1023/<size>`, 1024 bytes.
   - an out-of-range start → **416**, `Content-Range: bytes */<size>`.
   - a short-file suffix `-99999999` → full file (not 416) per W-3.
   - RSS stays flat downloading a large book (streamed, not buffered).
6. Signed-out `GET /api/scan/failures` → **401**; with a `FailedImport` row, the
   library page shows the banner with the file **basename** (not a full path) and
   a dismiss button.

## Deviations from Plan

The plan's Task 2 automated check included `! grep -q "filePath"` on the failures
route. Per **plan-check W-2**, that blanket grep is wrong: the route legitimately
reads `row.filePath` to compute `path.basename`. Verification was done instead by
asserting the **response shape** — the emitted object exposes only
`id/name/reason/format/failedAt`, with no `filePath` key — which is the real
privacy invariant (no full path reaches the client). No behavior changed; only the
verification method.

Otherwise plan executed as written. W-1 and W-3 were handled in-place (distinct
branch-B fixture; RFC 7233 suffix-range clamp) as the plan-check directed.

## Threat Surface

Implements the planned mitigations: T-03-05 (stream via `createReadStream`, no
whole-file buffer), T-03-06 (defensive Range parse + clamp, 416 on unsatisfiable),
T-03-07 (session-gated failures endpoint, basename-only response, no path leak),
T-03-08 (`path.resolve(book.filePath)` preserved — only scanner-recorded paths
served). T-03-SC holds: no new dependency. No new security-relevant surface beyond
the plan's threat model.

## Known Stubs

None. `writeCover` is stubbed **only inside the test suite** (so branch tests
don't touch the prod cover-cache dir); production code is unchanged. ROBUST-05 is
now complete end-to-end: recording (Plan 03-01) + surface (this plan).

## Self-Check: PASSED

- Created files exist: src/app/api/scan/failures/route.ts,
  src/components/FailedImportsBanner.tsx, tests/scanner.test.ts,
  tests/fixtures/{valid,valid2}.epub, tests/fixtures/valid.pdf,
  tests/fixtures/corrupt.epub.
- Modified files exist: src/app/api/books/[id]/file/route.ts, src/app/page.tsx.
- Commits exist: 05c1018 (Task 1), 47121e1 (Task 2), d9a5374 (Task 3).
