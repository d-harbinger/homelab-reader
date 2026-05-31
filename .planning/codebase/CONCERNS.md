# Codebase Concerns

**Analysis Date:** 2026-05-31

> Scope note: This is an early-phase project (CLAUDE.md still calls the
> architecture "target — Phase 0 is just scaffold"). Several gaps below are
> acknowledged-as-deferred in code comments. They are listed anyway because
> the app already ships multi-user auth and a LAN-exposed Docker image, so
> the security/isolation gaps are live, not hypothetical.

## Tech Debt

**No automated tests anywhere:**
- Issue: The repo has zero test files and no test runner. `package.json` (`scripts` block) has `lint` and a typecheck path but no `test` command; there is no `jest.config.*` / `vitest.config.*` / `playwright.config.*`.
- Files: entire `src/` tree; especially the security-critical and parsing-heavy modules `src/lib/scanner/index.ts`, `src/lib/scanner/epub.ts`, `src/lib/scanner/pdf.ts`, `src/lib/current-user.ts`, and every route under `src/app/api/`.
- Impact: Auth/authorization regressions, per-user isolation breaks, path-traversal regressions, and scanner crashes all ship silently. Refactors are unguarded.
- Fix approach: Add Vitest. Start with route-level tests for per-user data isolation (notes/highlights/progress), the admin gates, and scanner idempotency (rename vs new-file vs content-change paths in `scanFile`).

**OPDS auth contract documented but not implemented:**
- Issue: The most recent commit (`4cb6ec3 docs: OPDS auth cross-repo contract`) describes per-user HTTP Basic/Bearer auth for OPDS, but no code enforces it. `src/auth.config.ts:40` explicitly exempts `/api/opds` from the cookie gate with the comment "its own auth lands with the OPDS phase," and the OPDS handlers (`src/app/api/opds/route.ts`, `src/app/api/opds/all/route.ts`, `src/app/api/opds/recent/route.ts`) perform no auth at all.
- Files: `src/auth.config.ts:33-52`, `src/app/api/opds/route.ts`, `src/app/api/opds/all/route.ts`.
- Impact: See Security below — the entire catalog is anonymously enumerable.
- Fix approach: Implement the documented Basic/Bearer check in the OPDS handlers (they are exempt from middleware, so the check must live in the route, not the gate), then attribute progress per OPDS user.

**Whole-file reads instead of streaming:**
- Issue: `src/app/api/books/[id]/file/route.ts:28` does `fs.readFile(filePath)` and returns the full buffer; `src/lib/scanner/pdf.ts:25` reads the whole PDF into a buffer for metadata, then `renderFirstPageCover` (`pdf.ts:119-135`) re-opens the same file a second time via `pdf-to-img`; `src/lib/scanner/epub.ts:68-98` buffers every zip entry into a `Map<string, Buffer>`.
- Files: `src/app/api/books/[id]/file/route.ts:28`, `src/lib/scanner/pdf.ts:25,61`, `src/lib/scanner/epub.ts:68-98`.
- Impact: Memory scales with book size. A few concurrent large-PDF/EPUB downloads or a scan of a large library can spike RSS and OOM a small homelab container.
- Fix approach: Stream the file route via a `ReadableStream` / `fs.createReadStream` with Range support. For the scanner, read the PDF once and pass bytes to the cover renderer instead of re-reading by path.

**`bookCountUnder` / location prefix match is substring-prefix, not path-boundary safe in one spot:**
- Issue: `removeScanLocation` and `bookCountUnder` build the prefix as `path + path.sep` to avoid `/books` matching `/books-archive` — good. But the same care is not applied uniformly elsewhere, and the match relies on `filePath` always being stored normalized (it is, via `path.resolve`, but only because the scanner is the sole writer).
- Files: `src/lib/scanner/locations.ts:25-31,91-92`.
- Impact: Low today. Becomes a correctness risk if any future code writes a `Book.filePath` that isn't `path.resolve`-normalized.
- Fix approach: Centralize path normalization on write; keep the trailing-separator prefix everywhere.

## Known Bugs

**`/api/scan` POST is missing the admin gate (privilege gap, not just debt):**
- Symptoms: Any signed-in account (including a `reader`) can trigger a full filesystem rescan of every library folder.
- Files: `src/app/api/scan/route.ts:7-35` — `POST` calls `walkAndScan` directly with no `requireAdmin()`. Contrast with `src/app/api/locations/route.ts:37-42` and `src/app/api/users/route.ts:21-26`, which do gate on `requireAdmin()`.
- Trigger: Authenticated `POST /api/scan`.
- Workaround: None in-app.

**Auth throw surfaces as 500, not 401, in data routes:**
- Symptoms: In `notes`, `highlights`, and `progress` routes, `getCurrentUserId()` throws `UnauthenticatedError` but the call is not wrapped in try/catch, so an unauthenticated/expired-session request returns an unhandled 500 instead of 401.
- Files: `src/app/api/notes/route.ts:33,62`; `src/app/api/highlights/route.ts:37,66`; `src/app/api/progress/route.ts:31,67`. The `authError()` helper that maps these correctly exists only in `users/route.ts:51` and `locations/route.ts:15` and is not used here.
- Trigger: Session cookie expires between page load and a save; middleware normally blocks this, so it is edge-triggered rather than always-on.
- Workaround: Middleware (`src/middleware.ts:11`) catches most cases by redirecting before the route runs; the throw is the defensive inner layer that mis-maps.

## Security Considerations

**OPDS endpoints expose the full catalog with no authentication:**
- Risk: `/api/opds`, `/api/opds/all`, `/api/opds/recent` are exempt from the auth gate (`src/auth.config.ts:40`) and have no internal check. The acquisition feed lists every book and links each to `/api/books/<id>/file`.
- Files: `src/app/api/opds/route.ts:6`, `src/app/api/opds/all/route.ts:11-42`, `src/lib/opds.ts:113-115`.
- Current mitigation: The app binds to the LAN only (`docker-compose.yml:81`, `0.0.0.0:3333`); there is no internet exposure by default. The acquisition link target (`/api/books/[id]/file`) IS behind the cookie gate, so anonymous catalog browsing leaks titles/authors/covers but not file bytes.
- Recommendations: Implement the documented per-user Basic/Bearer auth in the OPDS handlers before any non-LAN exposure. Until then, document that OPDS metadata (titles/authors/descriptions) is readable by anyone on the LAN.

**`/api/books/[id]/file` and `/api/covers/[id]` enforce no per-book/per-user authorization:**
- Risk: These routes only check that the book row exists, not who is asking (beyond the cookie gate). Any authenticated user can download any book's bytes and cover. There is no concept of per-user library scoping.
- Files: `src/app/api/books/[id]/file/route.ts:17-47`, `src/app/api/covers/[id]/route.ts:15-48`.
- Current mitigation: Both sit behind the middleware cookie gate (`src/middleware.ts:11` matches everything except `api/auth` and static), so a session is required. Path-escape is genuinely defended — the file route serves only `book.filePath` recorded by the scanner (`books/[id]/file/route.ts:25`), never a user-supplied path, and covers go through `resolveCoverPath` which rejects escapes (`src/lib/scanner/covers.ts:20-27`).
- Recommendations: Acceptable for a shared-household model. If per-user libraries are ever a goal, add an authorization check tying the book to the requesting user.

**Admin filesystem browse (`/api/fs`) walks the entire container filesystem:**
- Risk: `/api/fs?path=...` resolves any admin-supplied path and lists its subdirectories, starting from `/`. This is intentional (folder picker for libraries) and admin-gated, but it means an admin session can enumerate the whole container filesystem tree.
- Files: `src/app/api/fs/route.ts:16-63`. `requireAdmin()` is enforced (`fs/route.ts:18`); `path.resolve` normalizes but does not confine to a root (`fs/route.ts:30`).
- Current mitigation: Admin-only; container runs `cap_drop: ALL` and `no-new-privileges` (`docker-compose.yml:94-97`), and the books mount is read-only (`docker-compose.yml:86`).
- Recommendations: Acceptable given the admin trust boundary. Consider confining the browse root to mounted volumes (`/app/books`, `/app/data`) so a compromised admin session can't enumerate the rest of the image.

**Setup first-run race is mitigated but TOCTOU-shaped:**
- Risk: `/setup` creates the first admin. The double-check pattern (`src/app/setup/page.tsx:19` and again at `:27`) guards against a second admin via direct POST, but `userCount()` + `createUser()` is not transactional.
- Files: `src/app/setup/page.tsx:14-52`.
- Current mitigation: Two checks plus the `username @unique` constraint (`prisma/schema.prisma:30`) make a real double-admin race extremely unlikely.
- Recommendations: Low priority. A single transactional "create first admin only if zero users" would close the window fully.

**No rate limiting on the credentials login:**
- Risk: `authorize` in `src/auth.ts:19-37` does a bcrypt compare per attempt with no throttle or lockout.
- Files: `src/auth.ts:14-38`.
- Current mitigation: bcrypt cost 12 (`src/lib/users.ts:67,83`) makes each attempt expensive; LAN-only exposure limits the attacker pool.
- Recommendations: Add per-IP/per-username attempt throttling before any internet exposure.

## Performance Bottlenecks

**SQLite has no concurrency tuning for a multi-user, watcher-driven workload:**
- Problem: No `busy_timeout`, WAL mode, or `connection_limit` is set anywhere (confirmed: no matches for these in `*.ts`, `*.prisma`, `Dockerfile`, compose). The Prisma client is the plain singleton (`src/lib/prisma.ts:7-11`).
- Files: `src/lib/prisma.ts`, `prisma/schema.prisma:23-26`, `.env.example:6`.
- Cause: SQLite serializes writes and, without WAL + a busy timeout, a writer (the chokidar scanner doing `book.create`/`update`/`deleteMany`) can collide with concurrent reader saves (progress/notes/highlights), surfacing `SQLITE_BUSY` / "database is locked".
- Improvement path: Set `?connection_limit=1` for the SQLite URL and enable WAL + a `busy_timeout` PRAGMA at startup. This is the standard fix for "Prisma + SQLite + a background writer."

**Scanner does no concurrency control across watcher events:**
- Problem: Each chokidar `add`/`change`/`unlink` fires an independent async `scanFile`/`removeFileFromLibrary` (`src/lib/scanner/watcher.ts:110-135`). On a large initial scan many run concurrently, each reading + hashing a whole file and, for PDFs, rendering a cover.
- Files: `src/lib/scanner/watcher.ts:110-135`, `src/lib/scanner/index.ts:34-140`.
- Cause: No queue or concurrency cap; combined with whole-file buffering (above) and SQLite write serialization, a big library import can spike memory and contend on the DB.
- Improvement path: Add a small concurrency-limited queue around `scanFile`. The hash-first idempotency (`index.ts:48-59`) already keeps repeat scans cheap; the cap protects the cold-start burst.

## Fragile Areas

**EPUB reader client (`EpubReader.tsx`) — 710 lines, the largest file, with untyped epub.js seams:**
- Files: `src/components/EpubReader.tsx` (710 lines). Multiple `unknown`-typed event handlers and a locally-declared epub.js interface (`EpubReader.tsx:47-62,254,308,363`) plus an `eslint-disable react-hooks/exhaustive-deps` at `:381`.
- Why fragile: epub.js types are hand-rolled as `unknown` spreads, so a library change won't be caught by the typechecker; the disabled exhaustive-deps means relocation/selection wiring depends on a manually-curated dependency list.
- Safe modification: Read the whole relocation/selection lifecycle before touching it; the CLAUDE.md hard-rule about reading before editing the reader specifically calls this file out.
- Test coverage: None.

**Scanner metadata extraction trusts third-party file structure:**
- Files: `src/lib/scanner/epub.ts:24-98` (yauzl + fast-xml-parser), `src/lib/scanner/pdf.ts:20-75` (pdfjs).
- Why fragile: Malformed EPUB/PDF inputs are common in real libraries. The code throws on missing `container.xml`/OPF (`epub.ts:28,33,38`) and the cover render swallows errors (`pdf.ts:128-134`), but a throw inside `extractEpub` only logs at the watcher boundary (`watcher.ts:114-116`) and drops the book silently.
- Safe modification: Keep extraction failures non-fatal per-file (already the case) and surface a "failed to import" signal to the UI rather than silently omitting the book.
- Test coverage: None — this is the highest-value place to add fixture-based tests (a few real and a few deliberately-malformed EPUB/PDF files).

**Watcher state on `globalThis`:**
- Files: `src/lib/scanner/watcher.ts:18-32`.
- Why fragile: State is stashed on `globalThis.__homelabReaderWatcher` to survive Next's instrumentation-vs-handler module split. Correct for the documented reason, but it means watcher lifecycle is process-global and not reset between hot-reloads cleanly; a stale watcher can linger in dev.
- Safe modification: Always go through `restartWatcher()` rather than constructing watchers directly.

## Scaling Limits

**Single SQLite file, single container:**
- Current capacity: Fine for a household-scale LAN (a handful of concurrent readers).
- Limit: SQLite write serialization (see Performance) caps concurrent-writer throughput; whole-file buffering caps practical book size and concurrent downloads by available container memory.
- Scaling path: WAL + busy_timeout first; streaming file responses second; a scan queue third. Postgres is not warranted at this scale.

**OPDS feeds are unpaginated:**
- Current capacity: `/api/opds/all` returns the entire library in one feed (`src/app/api/opds/all/route.ts:11-16`, comment acknowledges "Pagination is a later phase").
- Limit: Very large libraries produce a single large XML payload built entirely in memory (`feedXml` joins all entries — `src/lib/opds.ts:44-63`).
- Scaling path: Add OPDS paging links once libraries grow past a few thousand titles.

## Dependencies at Risk

**Bleeding-edge major versions across the core stack:**
- Risk: Next.js 15 + React 19 + Tailwind v4 + NextAuth v5 (beta line) + chokidar 5 + Prisma 6 are all recent majors. CLAUDE.md already notes Turbopack is pinned dev-only because it "+ Next standalone output" haven't GA'd together.
- Impact: Upgrade churn and ecosystem-compatibility surprises; NextAuth v5's API is still moving.
- Migration plan: Pin versions (lockfile present), watch NextAuth v5 release notes, and keep the dev-only Turbopack constraint until the GA alignment lands.

**pdfjs cover rendering depends on `pdf-to-img` + native canvas wiring:**
- Risk: `renderFirstPageCover` imports `pdf-to-img` (`src/lib/scanner/pdf.ts:123`), which pulls canvas/font machinery that is historically fragile on Node.
- Impact: Cover render failures (already swallowed to a placeholder) and potential native-build issues across base images.
- Migration plan: Failure is already non-fatal; keep the try/catch and the format-badge fallback. Re-evaluate if a lighter renderer becomes available.

## Missing Critical Features

**Per-user data export / backup story:**
- Problem: Notes/highlights/progress live only in the SQLite file on the data volume; there is no export endpoint.
- Blocks: Migrating a user's annotations, or syncing the documented "same notes shape" with the sibling android-reader, has no API surface yet.

**OPDS authentication (see Security):** the bridge to android-reader is documented but not yet enforced; android-reader cannot authenticate to fetch user-scoped data.

## Test Coverage Gaps

**Per-user isolation (highest priority):**
- What's not tested: That notes/highlights/progress are scoped by `userId` and that one user cannot read or mutate another's. The logic is correct today (`src/app/api/notes/route.ts:62-66`, `notes/[id]/route.ts:23-26,46-49`, `highlights/route.ts:66-70`, `progress/route.ts:38-50,67-70`), but nothing guards against a regression.
- Files: all routes under `src/app/api/notes/`, `src/app/api/highlights/`, `src/app/api/progress/`.
- Risk: A future "list all notes" convenience or a dropped `userId` filter silently leaks one user's annotations to another.
- Priority: High.

**Authorization gates:**
- What's not tested: That `/api/users`, `/api/users/[id]`, `/api/locations`, `/api/fs` reject non-admins and unauthenticated callers, and the last-admin / self-delete guards (`src/app/api/users/[id]/route.ts:32-39,81-99`).
- Files: `src/app/api/users/`, `src/app/api/locations/`, `src/app/api/fs/route.ts`.
- Risk: A refactor of `requireAdmin` or the middleware matcher silently opens an admin route. Would also catch the existing `/api/scan` missing-gate bug.
- Priority: High.

**Scanner idempotency and the three `scanFile` branches:**
- What's not tested: hash-match-moved-file, same-path-content-changed, and brand-new-file paths (`src/lib/scanner/index.ts:50-140`), plus reconcile-on-ready (`watcher.ts:137-161`) and malformed-archive handling (`epub.ts`).
- Files: `src/lib/scanner/index.ts`, `src/lib/scanner/watcher.ts`, `src/lib/scanner/epub.ts`, `src/lib/scanner/pdf.ts`.
- Risk: A regression here corrupts the library (drops books, duplicates rows, or loses notes on a rename) without any signal.
- Priority: Medium-High.

---

*Concerns audit: 2026-05-31*
