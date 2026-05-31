---
phase: 03-resource-safety-robustness
reviewed: 2026-05-30T00:00:00Z
depth: deep
files_reviewed: 13
files_reviewed_list:
  - src/app/api/books/[id]/file/route.ts
  - src/lib/concurrency.ts
  - src/lib/prisma.ts
  - src/instrumentation.ts
  - src/lib/scanner/pdf.ts
  - src/lib/scanner/failed-imports.ts
  - src/lib/scanner/watcher.ts
  - src/lib/scanner/index.ts
  - src/app/api/scan/failures/route.ts
  - src/components/FailedImportsBanner.tsx
  - src/app/page.tsx
  - prisma/migrations/20260601000000_failed_imports/migration.sql
  - tests/scanner.test.ts
findings:
  critical: 0
  warning: 3
  info: 5
  total: 8
status: issues_found
---

# Phase 3: Code Review Report

**Reviewed:** 2026-05-30T00:00:00Z
**Depth:** deep
**Files Reviewed:** 13
**Status:** issues_found

## Summary

Reviewed the Phase 3 resource-safety/robustness changes: HTTP Range streaming for
book downloads, SQLite WAL/busy_timeout boot tuning, an in-house concurrency
limiter, PDF read-once extraction, the FailedImport surface (model + record/clear
wiring + API + banner), and the scanner branch tests.

The two sharpest areas the brief flagged came out **clean**:

- **Range streaming** is RFC-7233-correct. Inclusive-end arithmetic
  (`Content-Length = end-start+1`), `Content-Range: bytes start-end/size`, 206 vs
  200, 416 with `bytes */size`, suffix-clamp (`bytes=-n`, n>=size → full file, not
  416), multi-range safe-ignore, and inverted/past-EOF → 416 are all handled.
  Traced every branch of `parseRange` against boundary inputs — no off-by-one.
- **PDF buffer detach** is correctly defended. `new Uint8Array(buffer)` invokes the
  typed-array **copy** constructor (a Node Buffer is a `Uint8Array`), so `data`
  handed to `getDocument` does NOT share the backing `ArrayBuffer` with `buffer`.
  The cover renderer then gets a third independent copy via `Buffer.from(buffer)`.
  pdfjs neutering `data` cannot corrupt the cover path. Cover failure stays
  non-fatal (caught, returns `undefined`).
- **Concurrency limiter** is correct: caps at `max`, releases on both resolve and
  reject via `.finally(next)` (no permit leak on a throwing `scanFile`), drains
  FIFO via `queue.shift()`, never exceeds `max`, and forwards `fn`'s result so
  callers keep their try/catch. In-house, no `p-limit` dependency added.
- **fd leak on disconnect**: `Readable.toWeb` returns a web stream whose `cancel`
  destroys the source Node stream (closing the fd). The standard runtime path
  closes it on client abort. See IN-01 for the residual gap.

The remaining findings are robustness/maintainability warnings, not blockers. No
secrets, no path-traversal regression (path comes only from the DB-recorded
`book.filePath`, never the request), no full-path leak in the failures API or
banner (basename only), and no privacy violations in `.env.example` / fixtures /
docs.

## Warnings

### WR-01: `busy_timeout` is a per-connection PRAGMA and may not survive pool reconnects

**File:** `src/lib/prisma.ts:27-42`, `src/instrumentation.ts:15`
**Issue:** `PRAGMA journal_mode=WAL` is durable — it is written into the database
file header and persists across connections and restarts. But `PRAGMA
busy_timeout=5000` is **connection-local**: it applies only to the connection that
executed it and is reset to the SQLite default (0) on any new connection. The code
relies on `?connection_limit=1` keeping a single connection alive so the timeout
sticks, but Prisma's pool can lazily open, drop on idle, or recycle the underlying
connection. If the connection that ran the boot PRAGMA is later replaced, writers
revert to failing immediately with `SQLITE_BUSY` instead of waiting 5s — exactly
the contention the phase set out to fix, and it would resurface intermittently
(hard to reproduce). WAL would still be in effect, masking how often the timeout
silently dropped.
**Fix:** Don't depend on a one-shot boot PRAGMA for the per-connection timeout.
Either re-assert `busy_timeout` per logical write path, or — cleaner — let the
SQLite driver set it on every connection. Prisma's native SQLite connector does not
accept `busy_timeout` in the URL, so the robust options are: (a) keep WAL at boot
(durable) and document that busy_timeout is best-effort, or (b) wrap contended
writes in a retry-on-SQLITE_BUSY helper. At minimum, add a code comment that
busy_timeout durability is contingent on the single pooled connection not being
recycled, so a future reader doesn't assume it's guaranteed.

### WR-02: Stream route has no explicit `'error'` handler and no request-abort wiring

**File:** `src/app/api/books/[id]/file/route.ts:148,160-167`
**Issue:** `createReadStream` can emit an asynchronous `'error'` event after the
`fs.stat` check passed — e.g. the file is deleted, the volume unmounts, or a
permission flips between stat and read. `Readable.toWeb` does forward stream errors
into the web stream (so this won't crash the process), but there is no explicit
listener and no propagation of `req.signal` (AbortSignal) into the read stream.
On an early client disconnect the runtime's `cancel()` is relied upon to tear the
fd down; if that path is ever skipped (or for a slow client that aborts mid-206),
the open fd lives until GC. For a server that streams large EPUB/PDF blobs to
android-reader over a LAN, leaked fds accumulate.
**Fix:** Attach the request abort signal and a defensive error handler, e.g.:
```ts
const stream = createReadStream(filePath, { start, end });
req.signal.addEventListener("abort", () => stream.destroy(), { once: true });
stream.on("error", (err) => {
  console.warn(`[file] stream error for ${book.id}`, err);
  stream.destroy();
});
```
This guarantees the fd is released on client abort and on a mid-stream read error
regardless of the toWeb adapter's behavior.

### WR-03: Test asserts `clearFailedImport` directly instead of the watcher's success path

**File:** `tests/scanner.test.ts:190-211`
**Issue:** The "a later successful import clears the failure" test calls
`scanFile(at)` and then **manually** calls `clearFailedImport(at)`. The actual
clear-on-success behavior lives in the watcher's `add`/`change` handlers
(`watcher.ts:139,155`), which are never exercised here. The test therefore proves
`clearFailedImport` deletes a row (already covered implicitly) but does NOT prove
that a successful re-scan triggers the clear — the wiring the test name claims to
verify. If someone removed the `await clearFailedImport(filePath)` line from the
watcher handler, this test would still pass, leaving a real regression (a fixed
book stuck in the failures banner forever) uncaught.
**Fix:** Extract the watcher's per-event body into a testable function (e.g.
`handleAdd(filePath)`) and call that, or assert the documented contract by driving
the actual handler. The test's own comment ("the watcher clears the failure on
success") acknowledges the gap; close it rather than hand-calling the helper.

## Info

### IN-01: No bounded queue / backpressure on the concurrency limiter

**File:** `src/lib/concurrency.ts:19-46`
**Issue:** The limiter caps in-flight work at `max=4` but the pending `queue` is
unbounded. A cold-start scan of a very large library enqueues one closure per file
up front (chokidar fires `add` per file before any complete). Each queued closure
holds a `filePath` string and promise machinery — bounded and cheap, so this is not
a correctness bug, but the "bounds the burst" claim in the comment only bounds
concurrency, not queue depth.
**Fix:** Document that the queue is unbounded by design (memory per queued item is
trivial), or accept the current behavior. No action required for v1.

### IN-02: Range route omits `Vary: Range` / `Vary` on cached responses

**File:** `src/app/api/books/[id]/file/route.ts:122-129`
**Issue:** Responses carry `Cache-Control: private, max-age=3600` but no `Vary:
Range`. A shared/intermediary cache (or aggressive client cache) could serve a
cached 206 partial as if it were the full body, or vice-versa. With `private` the
real-world blast radius is small, but `Accept-Ranges` advertising range support
without `Vary: Range` is technically incorrect.
**Fix:** Add `Vary: Range` to `baseHeaders` (cheap, removes the ambiguity).

### IN-03: Failures API re-throws non-auth errors, surfacing Prisma details to Next

**File:** `src/app/api/scan/failures/route.ts:33-35`
**Issue:** `authError(e)` re-throws anything that isn't an `Unauthenticated`/
`Forbidden` error, so a Prisma/DB failure becomes a Next 500. In production Next
hides the message from the client, so this is not a leak, but the route's catch
gives the impression of full error handling when it only handles auth. Consistent
with the rest of the codebase's `authError` pattern, so low priority.
**Fix:** None required; optionally log the unexpected error before re-throwing for
observability.

### IN-04: `formatFromExtension` duplicates `formatOf` logic at the watcher boundary

**File:** `src/lib/scanner/watcher.ts:18-20` vs `src/lib/scanner/index.ts:16-21`
**Issue:** `formatFromExtension` re-derives epub/pdf from the extension, duplicating
`formatOf`. The watcher version defaults non-pdf to `"epub"` (safe because
`isBookFile` already gated it), but two places now own the same mapping — drift
risk if a third format is added.
**Fix:** Export and reuse a single extension→format helper from
`scanner/index.ts`.

### IN-05: Banner reason text is rendered verbatim from a server-stored error string

**File:** `src/components/FailedImportsBanner.tsx:60`, `src/lib/scanner/failed-imports.ts:8-13`
**Issue:** `f.reason` is the truncated extractor error message rendered into JSX.
React escapes it (no XSS), and the message is capped at 500 chars and contains no
caller-supplied path beyond what the extractor itself emits — but extractor errors
can embed the full file path (e.g. a fs error message), which the basename-only API
contract is trying to keep off the client. The 500-char cap truncates but does not
strip paths from the *reason*.
**Fix:** Confirm extractor error messages don't include absolute paths, or sanitize
`error` (strip path-like substrings) in `recordFailedImport` before storing, so the
`reason` shown in the banner can't leak a home-directory path the same way the
`name` field deliberately avoids.

---

_Reviewed: 2026-05-30T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_
