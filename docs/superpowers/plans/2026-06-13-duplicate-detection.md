# Semantic Duplicate Detection — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development (one slice = one Task, gated, then stop).

**STATUS:** PENDING · valid-as-of 2026-06-13
**Value:** H — owner question 2026-06-11 (first dogfood session). The scanner already converges **byte-identical** files (hash match re-points one row), but **same-work-different-file** (epub+pdf of one book, re-downloads, editions) has NO detection — the owner asked for exactly this. A read-only report surfaces the groups so the owner can decide what to prune.

**Goal:** A "possible duplicates" surface that groups existing `Book` rows that are probably the same work, **without touching the scanner or the schema.** Group by ISBN when present; fall back to a normalized title+author key.

**Architecture:** Pure grouping helper over `Book` rows (id, isbn, title, authors, format) → an array of groups of size ≥ 2. A thin session-gated route exposes it; a read-only page renders it. **NO schema change, NO scanner change** — this only *reports* on what exists. (Quality improves later: once D3 ISBN enrichment lands, more rows carry an ISBN and the strong key fires more often. The fallback key works today regardless.)

**Tech stack:** Next.js 15 App Router, Prisma/SQLite, NextAuth, Vitest.

---

## Why this is safe to build unattended

The destructive sharp edge the owner already noted — *"a deliberately twice-filed book shows in only one shelf"* because the scanner's hash-converge picks last-scan-wins — is a **scanner** behavior this plan does NOT alter. This report is purely additive and read-only: it never deletes, merges, or repoints a row. Any actual de-duplication (a "merge" or "ignore this pair" action) is explicitly **out of scope** and deferred to its own owner-gated plan, because it mutates the library of record.

---

## Load-bearing assumptions (field 8 — verify BEFORE building)

1. **`Book` carries `isbn String?`, `title String`, and an `authors` relation.**
   `grep -nE "isbn|title|authors" prisma/schema.prisma` — confirm `isbn` is nullable and `authors` is a relation (so the route must `include: { authors: true }`).
2. **Scanner already converges byte-dupes by hash** (so this report is about *semantic*, not byte, dupes — do not re-implement hash matching).
   `grep -n "findFirst({ where: { fileHash" src/lib/scanner/index.ts` → one hit (the repoint).
3. **Route-test seam** = the `tests/library-folders.test.ts` ephemeral-DB pattern (`vi.hoisted`, `vi.mock("@/lib/prisma")`, `vi.mock("@/auth")`, `asReader`/`signOut`, `prisma migrate deploy` in `beforeAll`, 401 body `{ error: "unauthenticated" }`).
4. **`withUser`** is the session gate. `grep -n "export function withUser" src/lib/route-helpers.ts`.

Any miss → STOP and report the diverged shape; do not fabricate.

---

## Decisions to bring (field 4 — defaults)

- **D-C1 · Strong key = normalized ISBN.** Default: **yes.** Normalize by stripping non-alphanumerics and upper-casing the ISBN-10 `X`. ISBN-13 and its ISBN-10 form are NOT cross-walked in v1 (a known, documented limitation — note it in the UI copy, not silently). Books sharing a normalized ISBN are one group.
- **D-C2 · Fallback key = normalized title + first author.** Default: **yes.** Normalize: lowercase, strip punctuation/diacritics, collapse whitespace (reuse the tokenization style already in `src/lib/metadata/openlibrary.ts` — extract a shared `normalizeText` rather than copy). First author only (multi-author ordering is unreliable across sources). A book with no authors falls back to title-only.
- **D-C3 · A book is in AT MOST ONE group.** Default: **yes** — prefer the ISBN group; only books with no ISBN are eligible for a title+author group. (Avoids a book appearing in two overlapping groups.)
- **D-C4 · Singletons are dropped.** Default: **yes** — only groups of size ≥ 2 are returned.
- **D-C5 · Cross-format is a SIGNAL, not a filter.** Default: an epub+pdf of the same work IS a duplicate group (the owner's primary case). The UI shows the format badge per member so the owner can keep one and prune the other.

---

## Automation guardrails (per-slice)

- ✅ **Auto-completable (agent-env)** — gate = vitest + tsc + build green, then commit:
  - **Slice 1** (`groupDuplicates` helper + `/api/books/duplicates` route + tests)
- 🛑 **STOP-for-human (owner-gated, host-verify)**:
  - **Slice 2** (the `/duplicates` page — browser render)
- 🚫 No schema, no scanner edits, no `prisma migrate dev`. No merge/delete action (out of scope). Guard denial = hard STOP.

---

## Slice 1 — `groupDuplicates` helper + route (agent-env, AUTO)

**Files:**
- Create: `src/lib/library/duplicates.ts` (pure)
- Create: `src/app/api/books/duplicates/route.ts`
- Create: `tests/duplicates.test.ts`
- Possibly modify: `src/lib/metadata/openlibrary.ts` (export a shared `normalizeText` if extraction is clean; otherwise add `src/lib/text/normalize.ts` and have openlibrary import it — do NOT duplicate the tokenizer)

- [ ] **Step 1 — failing test** covering every branch:
  - two books, same ISBN (one with hyphens `978-0-13-468599-1`, one without) → one group of 2;
  - two books, different ISBN, identical normalized title+author → one group of 2;
  - a book WITH an ISBN never joins a title+author group even if the title matches (D-C3);
  - a unique book → no group (D-C4);
  - epub + pdf, same ISBN → one group, members retain their `format` (D-C5);
  - empty input → `[]`.

  Signature:
  ```ts
  // src/lib/library/duplicates.ts
  export interface DupBook { id: string; title: string; format: string; isbn: string | null; authors: string[]; coverUrl: string | null; }
  export interface DupGroup { key: string; reason: "isbn" | "title-author"; books: DupBook[]; }

  // Group probable same-work duplicates. ISBN groups take priority; only
  // ISBN-less books are eligible for title+author grouping (a book is in at
  // most one group). Returns only groups of size >= 2. Pure + deterministic.
  export function groupDuplicates(books: DupBook[]): DupGroup[] { /* … */ }
  ```
  Run: `npx vitest run tests/duplicates.test.ts` → FAIL.

- [ ] **Step 2 — implement.** Two passes: (1) bucket by `normalizeIsbn(isbn)` for books with an ISBN; (2) for the remainder, bucket by `` `${normalizeText(title)}|${normalizeText(authors[0] ?? "")}` ``. Drop size-1 buckets. Stable order: groups sorted by first member's title; members by `addedAt`/insertion order (the route supplies order). Tag `reason`.

- [ ] **Step 3 — route:**
  ```ts
  // src/app/api/books/duplicates/route.ts
  import { NextResponse } from "next/server";
  import { prisma } from "@/lib/prisma";
  import { withUser } from "@/lib/route-helpers";
  import { groupDuplicates } from "@/lib/library/duplicates";

  // GET /api/books/duplicates — read-only report of probable same-work
  // duplicates (ISBN, then normalized title+author). Never mutates the library.
  export const GET = withUser(async () => {
    const books = await prisma.book.findMany({
      orderBy: { addedAt: "asc" },
      include: { authors: true },
    });
    const groups = groupDuplicates(
      books.map((b) => ({
        id: b.id,
        title: b.title,
        format: b.format,
        isbn: b.isbn,
        authors: b.authors.map((a) => a.name),
        coverUrl: b.coverPath ? `/api/covers/${b.id}` : null,
      })),
    );
    return NextResponse.json({ groups });
  });
  ```
  Extend the test with route 200 (groups derived from seeded rows) + 401 unauth. **No path field is ever read here** (no privacy concern — `filePath` is not selected/forwarded), but assert the payload carries no scan-root string anyway, for parity.

- [ ] **Step 4 — gate:** `npx vitest run tests/duplicates.test.ts && npx tsc --noEmit && npm run build`.
- [ ] **Step 5 — commit:** `feat(library): /api/books/duplicates — read-only same-work duplicate report (ISBN + title/author)`.

---

## Slice 2 — `/duplicates` surface (owner-gated, HOST-VERIFY)

**Files:** `src/app/duplicates/page.tsx` (+ a small `DuplicateGroup` component); a link from the library header or settings.

- [ ] Render each group: the strong/fallback reason, then the member cards with format badge + cover; copy makes clear this is a *report*, nothing is deleted. Note the ISBN-10↔13 limitation (D-C1) in plain language.
- [ ] **Host-verify (owner):** the owner's known epub+pdf pair shows as a group; a genuinely unique book does not; no false-merge.
- [ ] Commit: `feat(library): duplicates report page`.

> **Deferred (own plan, owner-gated):** a "keep one / ignore pair" action that mutates the library. Out of scope here precisely because it edits the library of record.

---

## Self-review

- **Read-only & additive:** no scanner change, no schema, no mutation — safe to build unattended; the destructive part (merging) is explicitly deferred.
- **Reuse integrity:** `withUser`, the `Book.isbn/title/authors` shape, and the library-folders test seam are real (verified 2026-06-13); the normalizer reuses openlibrary's tokenization rather than forking it.
- **Honest limitation:** ISBN-10↔13 non-crosswalk is documented in code + UI, not hidden.
