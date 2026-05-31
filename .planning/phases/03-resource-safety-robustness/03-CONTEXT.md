# Phase 3: Resource Safety & Robustness - Context

**Gathered:** 2026-05-31
**Status:** Ready for planning
**Mode:** Auto-generated (autonomous — decisions grounded in CONCERNS.md citations)

<domain>
## Phase Boundary

The container holds up under concurrent readers plus the background scanner
without DB-lock errors, memory spikes, or silently-dropped books — and the
scanner's reconcile branches are covered by tests. In scope: SQLite
concurrency tuning, a concurrency-limited scanner queue, streaming the
book-file download with Range support, reading each PDF once for metadata +
cover, surfacing failed imports to the UI, and scanner branch tests. Out of
scope: OPDS feed pagination (later), Postgres migration (not warranted at
household scale), and the EPUB-reader refactor.

Requirements: ROBUST-01, ROBUST-02, ROBUST-03, ROBUST-04, ROBUST-05, TEST-03.
All trace to `.planning/codebase/CONCERNS.md` (cited file:line).
</domain>

<decisions>
## Implementation Decisions

### ROBUST-01 — SQLite concurrency tuning
- Apply `PRAGMA journal_mode=WAL` and `PRAGMA busy_timeout=5000` once at server boot via a `applySqlitePragmas()` helper (new, in `src/lib/prisma.ts` or a sibling) called from `src/instrumentation.ts` `register()` BEFORE `startWatcher()` (Node-only path; runs once on boot). Use `prisma.$executeRawUnsafe`.
- Add `?connection_limit=1` to the SQLite `DATABASE_URL` so Prisma serializes writers (the standard Prisma+SQLite+background-writer fix). Update `.env.example` and document for the Docker `/data` deployment; do NOT hardcode a real path.
- Acceptance is largely behavioral (no `SQLITE_BUSY` under load) → host-run; agent-side asserts the PRAGMA helper + call site + the URL param exist.

### ROBUST-02 — Concurrency-limited scanner queue
- Wrap the per-event `scanFile`/`removeFileFromLibrary` dispatch in `src/lib/scanner/watcher.ts` (lines ~110-135) in a small in-house concurrency limiter (a minimal promise semaphore — NO new dependency). Cap concurrency low (e.g. 4) so a cold-start bulk import can't fan out unbounded. The existing hash-first idempotency keeps repeat scans cheap; the cap protects the cold burst.

### ROBUST-03 — Streaming file download with Range
- Replace the whole-file `fs.readFile` in `src/app/api/books/[id]/file/route.ts:28` with `fs.createReadStream` adapted to a web `ReadableStream`. Use `fs.stat` for size. Parse the `Range` request header: on a valid range return `206 Partial Content` with `Content-Range` + `Content-Length` for the slice; always send `Accept-Ranges: bytes`. Preserve the existing MIME, `Content-Disposition`, and path-escape behavior (serve only `book.filePath`, never a user path).

### ROBUST-04 — Read each PDF once
- In `src/lib/scanner/pdf.ts`, read the file into a buffer ONCE and pass the bytes to both metadata extraction and `renderFirstPageCover` (currently re-opens the same path via `pdf-to-img`). Confirm `pdf-to-img`'s buffer/Uint8Array input shape when planning. Keep cover-render failure non-fatal (already is).

### ROBUST-05 — Surface failed imports to the UI
- When EPUB/PDF extraction throws (currently logged at the watcher boundary and the book silently dropped), record a failed-import row instead. Add a Prisma model `FailedImport` { id, filePath (unique), format, error (message, truncated), createdAt }. HAND-WRITE the migration (this repo authors fixed-timestamp migration SQL — see `prisma/migrations/`; do NOT rely on host `migrate dev`), committed with the schema per CLAUDE.md.
- On a successful (re)import of the same path, clear its FailedImport row.
- Surface via `GET /api/scan/failures` (session-gated) and a dismissible banner/section in the library UI listing failed imports (path basename + reason) so a malformed book is visible, not invisible. Privacy: show the file basename, never a full home-dir path in committed UI copy.

### TEST-03 — Scanner branch tests
- Using the Phase 1 Vitest harness + a real ephemeral SQLite DB, cover the three `scanFile` branches (`src/lib/scanner/index.ts`): hash-match moved file (path update, no dup), same-path content-changed (re-extract), brand-new file (create); plus malformed-archive handling (a deliberately corrupt EPUB/PDF fixture creates a FailedImport rather than throwing past the boundary). Commit small fixture files under the tests tree.

### Claude's Discretion
- Exact semaphore implementation and concurrency cap value (document the choice).
- Web-stream adapter details for the Range response.
- UI placement/styling of the failed-import banner (follow the calm educational tone + existing components).
- Fixture construction (a few real + a few deliberately-malformed EPUB/PDF bytes).
</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- Prisma singleton `src/lib/prisma.ts` (no PRAGMA setup today); startup hook `src/instrumentation.ts` `register()` (Node-only, runs `startWatcher()`).
- Scanner: `src/lib/scanner/watcher.ts` (chokidar add/change/unlink → async scanFile, ~110-135), `src/lib/scanner/index.ts` (`scanFile` 3-branch idempotency ~48-140), `src/lib/scanner/epub.ts`, `src/lib/scanner/pdf.ts` (reads file twice: metadata + `renderFirstPageCover`).
- File route `src/app/api/books/[id]/file/route.ts` (whole-file `fs.readFile`, path-escape defended).
- Migration pattern: hand-authored SQL in `prisma/migrations/<fixed-ts>_name/migration.sql` (see the Phase 2 `20260531000000_opds_tokens` example).
- Test harness: `vitest.config.mts`, `tests/helpers/test-db.ts` (real ephemeral SQLite), `tests/helpers/auth-mock.ts`.
- Library UI components for the failed-import banner: `src/components/LibraryHeader.tsx`, `src/components/Section.tsx`, `src/app/page.tsx`.

### Established Patterns
- `node:` builtins, `@/*` alias, hand-shaped JSON, typed errors, kebab-case libs / PascalCase components. Cover-render + extraction failures already non-fatal per file at the watcher boundary.

### Integration Points
- New: a concurrency-limiter helper (lib), `applySqlitePragmas()`, `FailedImport` model + hand-written migration, `GET /api/scan/failures`, a failed-import UI banner, scanner tests + fixtures.
- `.env.example` + Docker docs: `?connection_limit=1` on the SQLite URL (placeholder paths only).

</code_context>

<specifics>
## Specific Ideas

- The whole phase is about the homelab container surviving real use: a multi-reader load against a background chokidar writer on one SQLite file. WAL + busy_timeout is the highest-leverage fix; streaming + the scan queue cap memory; the failed-import surface turns silent data loss into a visible signal.
- Behavioral confirmation (no SQLITE_BUSY, 206 on ranged requests, memory flat on large downloads) is host-run (host/VM split) — agent-side proof is source assertions + the scanner unit tests.
</specifics>

<deferred>
## Deferred Ideas

- OPDS feed pagination — later milestone (unrelated to this phase's robustness scope).
- Postgres — not warranted at household scale.
- Confining `/api/fs` browse root — Out of Scope this milestone (PROJECT.md).
</deferred>
