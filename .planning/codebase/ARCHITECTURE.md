<!-- refreshed: 2026-05-31 -->
# Architecture

**Analysis Date:** 2026-05-31

## System Overview

```text
┌─────────────────────────────────────────────────────────────────────┐
│                      Client surfaces                                 │
├──────────────────────┬────────────────────┬─────────────────────────┤
│  Browser (LAN PCs)   │  In-reader views   │  OPDS readers (mobile)  │
│  React UI            │  EpubReader /      │  android-reader,        │
│  `src/app/(pages)`   │  PdfReader         │  KOReader, etc.         │
│                      │  `src/components/` │                         │
└──────────┬───────────┴─────────┬──────────┴────────────┬────────────┘
           │ fetch / SWR         │ /api/books/[id]/file   │ /api/opds/*
           ▼                     ▼                        ▼
┌─────────────────────────────────────────────────────────────────────┐
│            Edge middleware (auth gate)  `src/middleware.ts`          │
│            authConfig.authorized()      `src/auth.config.ts`         │
└──────────────────────────────────┬──────────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────────┐
│            Route handlers (Node runtime)  `src/app/api/**/route.ts`  │
│   books · notes · highlights · progress · covers · scan · users ·   │
│   locations · tags · fs · opds                                       │
└───────┬─────────────────────────────┬───────────────────────────────┘
        │                             │
        ▼                             ▼
┌──────────────────────────┐  ┌───────────────────────────────────────┐
│  Domain helpers          │  │  Scanner subsystem                    │
│  `src/lib/`              │  │  `src/lib/scanner/`                   │
│  current-user · users ·  │  │  watcher (chokidar) · index (dispatch │
│  opds · highlight-colors │  │  + reconcile) · epub/pdf extractors · │
│                          │  │  covers · hash · locations            │
└───────────┬──────────────┘  └──────────────────┬────────────────────┘
            │                                     │
            ▼                                     ▼
┌─────────────────────────────────────────────────────────────────────┐
│  Prisma singleton  `src/lib/prisma.ts`  →  SQLite                    │
│  Source library (read-only)  /books  ·  Cover cache  /data/covers   │
└─────────────────────────────────────────────────────────────────────┘
```

## Component Responsibilities

| Component | Responsibility | File |
|-----------|----------------|------|
| Boot hook | Starts the folder watcher on server boot (Node runtime only) | `src/instrumentation.ts` |
| Auth gate (edge) | Decides who reaches matched routes; OPDS/login/setup exemptions | `src/auth.config.ts`, `src/middleware.ts` |
| Auth instance (node) | Credentials provider, bcrypt verify, JWT session | `src/auth.ts` |
| Scanner dispatch | Idempotent `scanFile`, hash-vs-path reconcile, DB writes | `src/lib/scanner/index.ts` |
| Watcher | chokidar add/change/unlink + ready-time DB reconcile; global state | `src/lib/scanner/watcher.ts` |
| Extractors | Format-specific metadata + cover extraction | `src/lib/scanner/epub.ts`, `src/lib/scanner/pdf.ts` |
| Locations | ScanLocation CRUD, `BOOKS_PATH` first-run seed | `src/lib/scanner/locations.ts` |
| Cover cache | Write/resolve cover bytes under `/data/covers` | `src/lib/scanner/covers.ts` |
| OPDS generator | OPDS 1.2 Atom feed + entry XML | `src/lib/opds.ts` |
| Current-user helpers | Session → user id/role, admin guard, typed errors | `src/lib/current-user.ts` |
| Prisma singleton | Single PrismaClient across module-split boots | `src/lib/prisma.ts` |
| REST routes | Thin handlers around domain helpers + Prisma | `src/app/api/**/route.ts` |
| Server pages | Data-load via Prisma, render React | `src/app/**/page.tsx` |
| Reader clients | epub.js / PDF.js rendering, annotation UI | `src/components/EpubReader.tsx`, `src/components/PdfReader.tsx` |

## Pattern Overview

**Overall:** Next.js 15 App Router monolith. Server-rendered pages + Node-runtime REST routes over a Prisma/SQLite store, with a long-lived background filesystem watcher started from the instrumentation hook. Mobile clients integrate over OPDS.

**Key Characteristics:**
- Filesystem is the source of truth for the library; the DB is a derived index keyed on `filePath` (unique) with `fileHash` for rename/change detection.
- Thin route handlers; logic lives in `src/lib/` helpers so routes stay near-trivial (`src/app/api/notes/route.ts` is representative).
- Background work (watcher) runs in-process, kept alive on `globalThis` to survive Next's instrumentation-vs-request module split (same reason as the Prisma singleton).
- Two-runtime auth split: edge-safe config (no bcrypt/Prisma) for middleware, full Node instance for the actual credential check.

## Layers

**Boot / background:**
- Purpose: Start the watcher so the library populates without a request
- Location: `src/instrumentation.ts` → `src/lib/scanner/watcher.ts`
- Contains: `register()`, seed-then-watch sequence
- Depends on: scanner subsystem, Prisma
- Used by: Next.js runtime (auto-invoked once per boot)

**Auth gate:**
- Purpose: Cookie-session gate for browser routes
- Location: `src/middleware.ts`, `src/auth.config.ts` (edge), `src/auth.ts` (node)
- Contains: route matcher, `authorized` callback, JWT/session callbacks
- Depends on: next-auth v5; node side adds bcrypt + Prisma
- Used by: every matched request; routes call `auth()` via `src/lib/current-user.ts`

**API / route handlers:**
- Purpose: REST around the DB + OPDS feeds + scan control
- Location: `src/app/api/**/route.ts`
- Contains: request parsing, validation, Prisma calls, JSON/XML/binary responses
- Depends on: `src/lib/` helpers, Prisma
- Used by: client pages (SWR/fetch), reader components, OPDS clients

**Domain helpers:**
- Purpose: Reusable logic kept out of routes/components
- Location: `src/lib/` (and `src/lib/scanner/`)
- Contains: scanner, opds, users, current-user, highlight-colors, prisma
- Depends on: Prisma, Node fs, format libs (yauzl, pdfjs-dist)
- Used by: routes, instrumentation, server pages

**UI:**
- Purpose: Library browse, book detail, in-app reading, admin
- Location: `src/app/**/page.tsx` (pages), `src/components/*.tsx` (widgets)
- Contains: server pages that load via Prisma; client components that fetch via SWR
- Depends on: API routes, swr, lucide-react, Tailwind v4
- Used by: browser

## Data Flow

### Library ingest (filesystem → DB)

1. `register()` runs on boot, seeds a ScanLocation from `BOOKS_PATH` if none exist, then starts the watcher (`src/instrumentation.ts:7`).
2. chokidar emits `add`/`change`/`unlink` for `.epub`/`.pdf` under enabled locations (`src/lib/scanner/watcher.ts:110`).
3. `scanFile` hashes the file, then reconciles: hash-match → update path only; path-match w/ new hash → re-extract, keep Book row + notes; else → create Book + Authors + Tags (`src/lib/scanner/index.ts:34`).
4. Format extractor pulls metadata + cover bytes (`src/lib/scanner/epub.ts:24`, `src/lib/scanner/pdf.ts:20`); cover written to `/data/covers` (`src/lib/scanner/covers.ts:8`).
5. On watcher `ready`, DB is reconciled against disk — Book rows whose files are gone get deleted (`src/lib/scanner/watcher.ts:137`).

### Browser read path

1. Library page mounts, SWR fetches `/api/books`, `/api/progress/recent`, `/api/books/recent`, `/api/tags/sections` on intervals (`src/app/page.tsx:34`).
2. `/api/books` builds a Prisma `where` from `q`/`format`/`tag`/`sort` query params and returns a projected list (`src/app/api/books/route.ts:19`).
3. Opening a book loads the server reader page, which reads the book + this user's Progress, parses the stored anchor, and renders the format-specific reader (`src/app/books/[id]/read/page.tsx:16`).
4. Reader fetches raw bytes from `/api/books/[id]/file`, which only serves paths recorded by the scanner — no user-supplied paths (`src/app/api/books/[id]/file/route.ts:17`).
5. Annotations POST to `/api/notes`, `/api/highlights`, `/api/progress`; each is attributed to the session user via `getCurrentUserId()` (`src/app/api/notes/route.ts:33`).

### OPDS path (mobile)

1. Reader hits `/api/opds` (exempt from the cookie gate per `authorized`) → root nav feed (`src/app/api/opds/route.ts:6`).
2. Subsections `/api/opds/all` and `/api/opds/recent` return acquisition feeds built by `feedXml`/`bookEntryXml` (`src/lib/opds.ts:44`).
3. Acquisition links point at `/api/books/[id]/file`; cover links at `/api/covers/[id]`.

**State Management:**
- Client: SWR with polling intervals; no global store. Reader settings persisted via `readSetting`/`writeSetting` (localStorage) in `src/components/ReaderToolbar.tsx`.
- Server: SQLite via Prisma. Watcher runtime state lives on `globalThis.__homelabReaderWatcher` (`src/lib/scanner/watcher.ts:18`).

## Key Abstractions

**Anchor (annotation position):**
- Purpose: Format-agnostic position for Note/Highlight/Progress
- Examples: stored as JSON string in `prisma/schema.prisma` (`anchor` columns)
- Pattern: EPUB → `{ type: "epub-cfi", cfi }`; PDF → `{ type: "pdf-page", page }` (range variants for highlights). Parsed per Book.format at read time (`src/app/books/[id]/read/page.tsx:62`).

**ExtractedCommon (scanner output):**
- Purpose: Unified shape both extractors normalize into before DB write
- Examples: `src/lib/scanner/index.ts:142`
- Pattern: per-format extractor → `extractFor` maps to common shape → single create/update path.

**ScanLocation:**
- Purpose: DB-configured library folders (multi-folder, admin-managed)
- Examples: `src/lib/scanner/locations.ts`, `prisma/schema.prisma:139`
- Pattern: watcher reads enabled paths from DB; `BOOKS_PATH` is only a first-run seed.

## Entry Points

**Server boot hook:**
- Location: `src/instrumentation.ts`
- Triggers: Next.js `register()` once per server start (Node runtime only)
- Responsibilities: seed first library, start watcher

**Edge middleware:**
- Location: `src/middleware.ts` (matcher excludes `api/auth`, `_next/*`, `favicon.ico`)
- Triggers: every matched request
- Responsibilities: enforce `authorized` callback; redirect signed-out users to `/login`

**API route handlers:**
- Location: `src/app/api/**/route.ts`
- Triggers: HTTP from browser, reader components, OPDS clients
- Responsibilities: validate, call helpers/Prisma, return JSON/XML/binary

**Server pages:**
- Location: `src/app/**/page.tsx`
- Triggers: navigation
- Responsibilities: load data via Prisma (`src/app/books/[id]/page.tsx`) or render client shells

## Architectural Constraints

- **Threading:** Single Node process, single event loop. The chokidar watcher and all extraction run in-process; large-file copies are debounced via `awaitWriteFinish` (`src/lib/scanner/watcher.ts:105`) so partial files aren't hashed.
- **Runtime split:** chokidar, yauzl, pdfjs-dist are Node-only. `src/instrumentation.ts` guards on `NEXT_RUNTIME === "nodejs"`; `next.config.ts` lists them in `serverExternalPackages`; `src/auth.config.ts` must stay free of bcrypt/Prisma because the middleware runs at the edge.
- **Global state:** Two deliberate `globalThis` singletons — `prisma` (`src/lib/prisma.ts:3`) and `__homelabReaderWatcher` (`src/lib/scanner/watcher.ts:18`) — both to survive Next's instrumentation-vs-request module split. Do not introduce module-scope mutable state that assumes a single module instance.
- **SQLite limits:** Prisma `mode: "insensitive"` is unsupported and throws; `contains` relies on SQLite's ASCII-case-insensitive LIKE (`src/app/api/books/route.ts:18`). Path queries use `startsWith` prefix matching since SQLite has no path operator (`src/lib/scanner/locations.ts:25`).
- **Source library is read-only:** the scanner never writes into the book folder; covers go to `/data/covers` out-of-band (`src/lib/scanner/covers.ts:5`).

## Anti-Patterns

### Reaching into Prisma directly from a route for scanner/location logic

**What happens:** A route could query/mutate ScanLocation or replicate scan reconcile inline.
**Why it's wrong:** The reconcile rules (hash-vs-path, ghost cleanup, prefix-delete on folder removal) live in one place; duplicating them drifts behavior.
**Do this instead:** Call helpers in `src/lib/scanner/locations.ts` and `src/lib/scanner/index.ts` (e.g. `addScanLocation`, `walkAndScan`, `removeFileFromLibrary`).

### Trusting client-supplied file paths

**What happens:** Serving a file by a path from the request.
**Why it's wrong:** Path-escape / arbitrary-read risk on a server with a real filesystem.
**Do this instead:** Look the Book up by id and serve only `book.filePath` recorded by the scanner (`src/app/api/books/[id]/file/route.ts:17`); cover reads go through `resolveCoverPath`'s escape guard (`src/lib/scanner/covers.ts:20`).

### Adding a new format by forking the scanner

**What happens:** Copying `scanFile`/watcher logic for a new extension.
**Why it's wrong:** Reconcile and DB-write logic fragments; the watcher already dispatches by extension.
**Do this instead:** Add `src/lib/scanner/<format>.ts` returning the common shape and register it in `formatOf`/`extractFor` and `isBookFile` (`src/lib/scanner/index.ts`).

### Forgetting per-user scoping on annotation reads

**What happens:** Listing notes/highlights/progress without `userId`.
**Why it's wrong:** The schema is multi-user (`@@unique([bookId, userId])`); cross-user leakage.
**Do this instead:** Scope every annotation query by `getCurrentUserId()` as in `src/app/api/notes/route.ts:62`.

## Error Handling

**Strategy:** Typed domain errors mapped to HTTP status at the route boundary; defensive try/catch around all filesystem and watcher I/O so one bad file never stops the system.

**Patterns:**
- `UnauthenticatedError` → 401, `ForbiddenError` → 403, surfaced via the shared `authError` helper (`src/app/api/users/route.ts:51`, `src/lib/current-user.ts`).
- Input-validation errors return 400 with a short JSON `{ error }`; unknown entities return 404 (`src/app/api/notes/route.ts`).
- Scanner swallows per-file errors with `console.error` and continues; `walkAndScan` returns `{ scanned, errors }` counts (`src/lib/scanner/index.ts:199`).
- `LocationError`/`UserInputError` carry user-facing messages back to admin UIs.

## Cross-Cutting Concerns

**Logging:** `console.*` only, namespaced with `[scanner]` prefixes. No logging framework.
**Validation:** Hand-rolled per route (shape checks, `slice` length caps on note/highlight bodies). No schema-validation library.
**Authentication:** next-auth v5 JWT sessions; edge gate in middleware, node check in `src/auth.ts`; admin routes call `requireAdmin()`. OPDS is exempt from the cookie gate and carries its own auth contract (`docs/OPDS-AUTH-CONTRACT.md`).
**Security headers:** Strict CSP + frame/permissions policy applied globally in `next.config.ts`.

---

*Architecture analysis: 2026-05-31*
