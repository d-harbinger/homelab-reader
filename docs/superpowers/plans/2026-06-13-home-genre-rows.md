# Home Genre Rows — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development (one slice = one Task, gated, then stop). Steps use checkbox (`- [ ]`) syntax.

**STATUS:** Slice 1 DONE (`54e154c`, night-built + orchestrator-gate-verified 2026-06-13: 9 tests, tsc 0, build 0, full suite 159/159) · Slices 2–3 PENDING · valid-as-of 2026-06-13
**Value:** H — owner request 2026-06-11 ("Netflix-style" landing rows). Turns the existing on-disk folder taxonomy into a browsable home lens with zero invented categories. Revives the parked Phase 2 of `2026-05-31-library-views-and-notes.md` with concrete owner intent.

**Goal:** A home page that opens onto genre rows derived from the **top-level folder** each book lives under (python/, ai/, …). Each row is recent-first and capped; a genre chip on each card names its top folder; Recently-added is capped to a single row.

**Architecture:** Pure lens over existing `Book` rows — **NO schema change** (D2's collections-cardinality decision stays untouched). Server derives the genre from `filePath` + scan roots using the *already-shipped* `relativeFolder()`; the absolute path never reaches the client (the same privacy invariant `/api/library/folders` and `/api/books` already hold). Mirror the shape of the existing `/api/tags/sections` route and the `buildFolderTree` test seam.

**Tech stack:** Next.js 15 App Router, Prisma/SQLite, NextAuth, TailwindCSS v4, Vitest (ephemeral-SQLite route harness).

---

## Load-bearing assumptions (field 8 — verify against live code BEFORE building)

Each must hold or the slice STOPS and reports (do not fabricate a shape):

1. **`relativeFolder(filePath, roots)` exists and returns the root-relative folder or `null`.**
   `grep -n "export function relativeFolder" src/lib/library/folder-tree.ts`
   → expect one hit. The top-level genre is `relativeFolder(fp, roots)?.split("/")[0] ?? null`.
2. **`/api/books` NEVER exposes `filePath`** (genre must be derived server-side, not on the client).
   `grep -n "filePath" src/app/api/books/route.ts` → only in the `where`/comparison, never in the response `.map`.
3. **`/api/tags/sections` is the section-shape to mirror** (`{ sections: [{ tag, books[] }] }`, `MIN_BOOKS`, `MAX_BOOKS_PER_SECTION`, `coverUrl` derivation).
   `cat src/app/api/tags/sections/route.ts`
4. **Route-test seam** = `vi.hoisted` ephemeral PrismaClient + `vi.mock("@/lib/prisma")` + `vi.mock("@/auth")` + `asReader()/signOut()` from `tests/helpers/auth-mock`, migrations via `prisma migrate deploy` in `beforeAll`. Unauth 401 body = `{ error: "unauthenticated" }`.
   `cat tests/library-folders.test.ts` (gold-standard mirror).
5. **`withUser` wrapper** is the session gate (auth-before-DB).
   `grep -n "export function withUser" src/lib/route-helpers.ts`
6. **`BookCardData`** is the card payload type the rows + grid consume.
   `grep -n "BookCardData" src/components/BookCard.tsx` — confirm the field set before adding `genre`.

If any of 1–6 fails, STOP: the live shape diverged from this plan; report the diff, do not guess.

---

## Decisions to bring (field 4 — recommended defaults; owner check-in is yes/no)

- **D-A1 · Genre granularity = TOP-LEVEL folder only.** Default: **yes** — `python/web` and `python/cli` both roll into the `python` row. (Owner said "from the TOP-LEVEL FOLDER taxonomy".) Deeper nesting stays reachable via the existing folder rail.
- **D-A2 · Row inclusion threshold.** Default: **MIN_BOOKS = 3** (mirror `/api/tags/sections`, keeps singleton-folder noise off the home page). Books directly under a scan root (no folder) group under no genre row — they still appear in the Library grid.
- **D-A3 · Row ORDER.** Default: **alphabetical by folder name** (stable, predictable, matches the rail). The owner's "recent-first" was about books *within* a row, not row order. Alternative on request: by book count desc (like tags).
- **D-A4 · Recently-added cap.** Default: **20** (one row). Today `showRecent` gates on `length >= 4`; the cap is applied server-side in `/api/books/recent` (confirm its current take/limit first) or sliced client-side — slice client-side only if the route has no limit param.
- **D-A5 · Genre chip source on a card.** Default: **the book's top-level folder** (consistent with the rows). Books with no folder show no chip.

---

## Automation guardrails (per-slice)

Execute ONE slice per run, gated on its own verification, then stop. Logic + API routes + builds verify in-environment; the home-page visual layout only the owner can confirm (browser). Do NOT batch and "verify visually at the end."

- ✅ **Auto-completable (agent-env)** — gate = `npx vitest run <file>` + `npx tsc --noEmit` + `npm run build` all green, then atomic commit:
  - **Slice 1** (`/api/genres/sections` route + grouping helper + tests)
  - **Slice 2** (derived `genre` on the card payload + tests)
- 🛑 **STOP-for-human (owner-gated, host-verify)**:
  - **Slice 3** (home wiring + chip render + Recently-added cap — needs a browser)
- 🚫 Never run `prisma migrate dev` (this plan needs none). A guard denial is a hard STOP — report and halt, never engineer around it.

---

## Slice 1 — `/api/genres/sections` route (agent-env, AUTO)

**Files:**
- Create: `src/lib/library/genre-sections.ts` (pure grouping helper — testable without DB/network)
- Create: `src/app/api/genres/sections/route.ts`
- Create: `tests/genre-sections.test.ts`

**Why a separate pure helper:** the grouping (filePath + roots → `{ genre, bookIds }[]`) is the testable core; the route is a thin Prisma+privacy wrapper. Mirrors how `buildFolderTree` is pure and `/api/library/folders` is the thin wrapper.

- [ ] **Step 1 — pure helper, failing test.** Write `tests/genre-sections.test.ts` covering EVERY branch this slice introduces:
  - groups books by top-level folder (`/books/python/web/a.epub` + `/books/python/b.epub` → one `python` group of 2);
  - a folder with `< MIN_BOOKS` books yields **no** section;
  - books directly under a root (no folder) are excluded from sections;
  - books under no scan root (`null` from `relativeFolder`) are excluded;
  - rows ordered alphabetically by genre (D-A3);
  - books within a row are recent-first (`addedAt desc`) and capped at `MAX_BOOKS_PER_SECTION`;
  - **privacy:** the helper input is `{ id, filePath, addedAt, … }[]` but the section output carries NO `filePath`.

  Pure-helper signature:
  ```ts
  // src/lib/library/genre-sections.ts
  import { relativeFolder } from "./folder-tree";

  export interface GenreSection<T> { genre: string; books: T[]; }

  // Group books into top-level-folder sections. `roots` are the enabled scan-
  // location paths. Pure + deterministic — no DB, no fs. The caller supplies
  // an already-ordered (recent-first) list and a card-mapper so this stays
  // path-private: filePath is read here ONLY to derive the genre and is never
  // forwarded into the section payload.
  export function groupByGenre<T extends { filePath: string }>(
    books: T[],
    roots: string[],
    opts: { minBooks: number; maxPerSection: number },
  ): GenreSection<T>[] { /* … */ }
  ```
  Run: `npx vitest run tests/genre-sections.test.ts` → FAIL (module missing).

- [ ] **Step 2 — implement the helper** until the test passes. Top-level genre = `relativeFolder(b.filePath, roots)?.split("/")[0]`; skip `null`/`""`; bucket; drop buckets `< minBooks`; sort buckets by `genre.localeCompare`; truncate each to `maxPerSection`. (Recency: the route hands it an `addedAt desc` list, so preserve input order.)

- [ ] **Step 3 — route, mirroring `/api/tags/sections` + `withUser`.**
  ```ts
  // src/app/api/genres/sections/route.ts
  import { NextResponse } from "next/server";
  import { prisma } from "@/lib/prisma";
  import { withUser } from "@/lib/route-helpers";
  import { groupByGenre } from "@/lib/library/genre-sections";

  const MIN_BOOKS = 3;
  const MAX_BOOKS_PER_SECTION = 18;

  // GET /api/genres/sections — home rows derived from the TOP-LEVEL on-disk
  // folder each book sits under. Session-gated. Privacy: filePath is read only
  // to derive the genre name (groupByGenre) and never leaves the server; the
  // payload mirrors /api/tags/sections ({ sections: [{ genre, books[] }] }).
  export const GET = withUser(async () => {
    const [books, locations] = await Promise.all([
      prisma.book.findMany({
        orderBy: { addedAt: "desc" },
        include: { authors: true },
      }),
      prisma.scanLocation.findMany({
        where: { enabled: true },
        select: { path: true },
      }),
    ]);
    const sections = groupByGenre(books, locations.map((l) => l.path), {
      minBooks: MIN_BOOKS,
      maxPerSection: MAX_BOOKS_PER_SECTION,
    }).map((s) => ({
      genre: s.genre,
      books: s.books.map((b) => ({
        id: b.id,
        title: b.title,
        format: b.format,
        authors: b.authors.map((a) => a.name),
        pageCount: b.pageCount,
        coverUrl: b.coverPath ? `/api/covers/${b.id}` : null,
      })),
    }));
    return NextResponse.json({ sections });
  });
  ```
  Add to the test: 200 happy path (genre rows derived from seeded rows) + 401 unauth (`{ error: "unauthenticated" }`) + the privacy assertion (`JSON.stringify(body)` contains no scan-root string).

- [ ] **Step 4 — gate.** `npx vitest run tests/genre-sections.test.ts && npx tsc --noEmit && npm run build` → all green.

- [ ] **Step 5 — commit.**
  ```bash
  git add src/lib/library/genre-sections.ts src/app/api/genres/sections/route.ts tests/genre-sections.test.ts
  git commit -m "feat(library): /api/genres/sections — top-level-folder home rows (session-gated, path-private)"
  ```

---

## Slice 2 — derived `genre` on the card payload (agent-env, AUTO)

**Goal:** a card knows its genre without the client ever seeing a path. Add a server-derived `genre: string | null` to the book-list payloads so a chip can render on `BookCard`.

**Files:**
- Modify: `src/app/api/books/route.ts` (add `genre` to each mapped book — derive via `relativeFolder(b.filePath, roots)?.split("/")[0] ?? null`; the route already fetches roots when filtering, so hoist the roots fetch to always-on)
- Modify: `src/components/BookCard.tsx` (extend `BookCardData` with optional `genre?: string | null` — type only this slice; the visual chip renders in Slice 3)
- Modify/Create test: `tests/books-genre-field.test.ts` (or extend `tests/books-folder-filter.test.ts`)

**Field-8 catch:** `/api/books` currently fetches `roots` only inside the `if (folder)` branch. Adding always-on genre derivation needs roots fetched unconditionally — verify the existing folder-filter test still passes (the `where` logic is unchanged; only the response map gains a field).

- [ ] **Step 1 — failing test:** seed books under `/books/python/...` and a root `/books`; assert `GET` response books carry `genre: "python"`; a book directly under the root carries `genre: null`; **privacy:** response still contains no scan-root path string.
- [ ] **Step 2 — implement:** hoist the roots fetch; map `genre` per book; keep `filePath` out of the response.
- [ ] **Step 3 — gate:** `npx vitest run tests/books-genre-field.test.ts tests/books-folder-filter.test.ts && npx tsc --noEmit && npm run build`.
- [ ] **Step 4 — commit:** `feat(library): derive top-level genre on the book payload (path-private)`.

> **Scope guard:** Slice 2 adds the field + type ONLY. Do NOT render the chip here (that is host-verify, Slice 3). Keeping the type/data change separate from the visual change keeps the agent-env gate honest.

---

## Slice 3 — home wiring + chip + Recently-added cap (owner-gated, HOST-VERIFY)

**Files:** `src/app/page.tsx`, `src/components/BookCard.tsx`, `src/components/Section.tsx` (if a row variant is needed).

- [ ] Fetch `/api/genres/sections` via SWR (mirror the `tagsResp` pattern); render genre `Section`s under Continue-reading / Recently-added, only when `!folderActive` (selecting a rail folder still narrows to the single filtered grid).
- [ ] Render the genre chip on `BookCard` from `genre` (small, low-contrast pill — match the existing card aesthetic; see `feedback_aesthetic_work_ownership` — do NOT invent a new visual language).
- [ ] Cap Recently-added to D-A4 (20).
- [ ] **Host-verify (owner, one dev-server session):** genre rows appear and match the on-disk shelves; chips read the right folder; rows are recent-first; selecting a rail folder still collapses to the filtered grid; no path leaks in the network tab.
- [ ] Commit: `feat(home): genre rows + genre chips + recently-added cap`.

**Done = the home page reads as shelves of genres, derived from disk, no invented taxonomy.**

---

## Self-review

- **Reuse integrity:** `relativeFolder`, `buildFolderTree`, `withUser`, `BookCardData`, the `/api/tags/sections` shape, and the `tests/library-folders.test.ts` seam are all real shipped symbols (verified 2026-06-13).
- **Privacy:** every server→client hop drops `filePath`; three explicit no-path-string assertions guard it.
- **No schema:** pure lens; D2 cardinality untouched; pairs cleanly with the relative-path migration (genre derivation moves to the stored folder once that lands, a 1-line change behind `relativeFolder`).
- **Agent-env first:** Slices 1–2 are runnable + gated tonight; Slice 3 is the only owner-gated piece.
