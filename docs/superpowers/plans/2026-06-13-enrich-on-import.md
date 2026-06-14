# Enrich-on-Import (D3) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Mixed lanes — the schema + scan-wiring is owner-present (`prisma migrate dev`); the pure pipeline composition + accept/reject logic is agent-env; the review screen is host-verify.

**STATUS:** Slice 2 DONE (`8d227a4` — `enrichBook`/`isThin`/`applyAcceptance` pure functions, orchestrator-gate-verified 2026-06-14: 15 tests, full suite 186/186, tsc 0, build 0; schema + scanner untouched) · Slice 1 (migration) + 3 (scan hook/routes) owner-present · Slice 4 host-verify · valid-as-of 2026-06-14
**Value:** H — owner dogfood 2026-06-11 specifically praised Zotero-style metadata detection and named this *"the highest-leverage candidate of the three."* The two halves already exist, shipped + unit-tested, and sit **dormant**: `parseFilenameSignals` (filename → title/ISBN) and `searchOpenLibrary` (→ ranked `MetadataSuggestion[]`). What's missing is the connective tissue: a place to store suggestions, the scan-time call that fills it, and a screen to accept/bulk-accept them.

**Goal:** On scan, a freshly-imported book whose metadata is thin gets ranked OpenLibrary suggestions stored against it; a review screen lets the owner accept the best match (or bulk-accept above a confidence threshold), writing the chosen fields back to the `Book`. FOSS, no Google — OpenLibrary only, matching the project's privacy posture.

**Architecture:** Build the connective tissue around the shipped core. New `MetadataSuggestion` table (the D3 schema, batched into the relative-path migration window). A pure `enrichBook(book, fetchImpl)` composer wiring `parseFilenameSignals → searchOpenLibrary` (fully unit-testable, network injected). A scan hook that calls it for thin books and upserts suggestions. A review route + screen that accepts a suggestion (transactional write-back).

**Tech stack:** Next.js 15, Prisma/SQLite, Vitest. OpenLibrary calls are network → injected in tests, best-effort in prod.

---

## Load-bearing assumptions (field 8 — verify BEFORE building)

1. **`parseFilenameSignals(filePath): EnrichQuery`** exists (title + isbn). `grep -n "export function parseFilenameSignals" src/lib/metadata/filename-signals.ts`.
2. **`searchOpenLibrary(query, opts): Promise<MetadataSuggestion[]>`** exists, ranked by `confidence`, network injectable via `opts.fetchImpl`, returns `[]` on any failure (never throws). `grep -n "export.*searchOpenLibrary\|fetchImpl\|confidence\|subjects\|workKey" src/lib/metadata/openlibrary.ts`.
3. **`MetadataSuggestion` is the openlibrary RETURN type** (source/confidence/title/authors/publishedYear/publisher/isbn/subjects/coverUrl/workKey) — the DB table name must NOT collide. **Name the Prisma model `BookSuggestion`** to avoid shadowing the lib's `MetadataSuggestion` interface.
4. **Scanner insert path** is `scanFile` in `src/lib/scanner/index.ts` (the `book.create` at the "New file path" branch). `grep -n "book.create" src/lib/scanner/index.ts`.
5. **`Book` already has `isbn`, `subtitle`, `publisher`, `publishedAt`, `description`, `language`, `pageCount`** — the write-back targets. Confirm against `prisma/schema.prisma`.
6. **No `BookSuggestion` model today.** `grep -n "BookSuggestion\|model.*Suggestion" prisma/schema.prisma` → no hit.

Any miss → STOP and report.

---

## Decisions to bring (field 4 — defaults)

- **D-3a · "Thin" trigger.** Default: enrich on scan when the extracted metadata is weak — **no ISBN, OR title equals the filename fallback, OR missing author** — so a well-tagged EPUB is not needlessly queried. (Avoids hammering OpenLibrary for books that already have good embedded metadata.)
- **D-3b · Suggestion volume.** Default: store the **top 5** ranked candidates per book (the lib's default limit). One `BookSuggestion` row per candidate, `status: "pending"`.
- **D-3c · Auto-accept threshold.** Default: **no silent auto-accept** in v1 — even a 0.95 match becomes a `pending` suggestion the owner accepts. (Metadata write-back is hard to notice if wrong; a power user wants the review. A later `--auto-above 0.9` is its own decision.) The review screen offers **bulk-accept above a slider threshold** instead.
- **D-3d · Write-back policy.** Default: accepting a suggestion fills **only empty/fallback `Book` fields** (don't clobber metadata the file actually carried), EXCEPT the owner can "force overwrite" per field in the review UI. ISBN + subjects (→ tags) + cover are the high-value fills. Transactional: write `Book`, mark the chosen `BookSuggestion` `accepted`, mark its siblings `rejected`.
- **D-3e · Re-enrich.** Default: a book with any non-`pending` suggestion is not re-queried on rescan (the owner already decided). A "re-enrich" action clears and re-queries.

---

## Automation guardrails (per-slice)

- ✅ **Auto-completable (agent-env)** — vitest + tsc + build, then commit:
  - **Slice 2** (`enrichBook` pure composer + accept/reject write-back logic as a pure/Prisma-tested function)
- 🛑 **STOP-for-human:**
  - **Slice 1** (owner-present): the `BookSuggestion` migration (`prisma migrate dev`) — batch with the relative-path + `Note.highlightId` window.
  - **Slice 3** (owner-present): the scan-hook wiring is agent-env logic but only meaningful against a migrated DB — gate it behind Slice 1.
  - **Slice 4** (host-verify): the review/accept screen (browser).
- 🚫 Never `prisma migrate dev` unattended. Guard denial = hard STOP.

---

## Slice 1 — `BookSuggestion` schema (OWNER-PRESENT)

```prisma
model BookSuggestion {
  id            String   @id @default(cuid())
  bookId        String
  source        String   // "openlibrary"
  confidence    Float
  title         String?
  authors       String   // JSON string[] (SQLite has no array)
  publishedYear Int?
  publisher     String?
  isbn          String?
  subjects      String   // JSON string[]
  coverUrl      String?
  workKey       String?  // OpenLibrary /works/OL…W — stable handle
  status        String   @default("pending") // pending | accepted | rejected
  createdAt     DateTime @default(now())

  book Book @relation(fields: [bookId], references: [id], onDelete: Cascade)
  @@index([bookId])
  @@index([status])
}
```
+ inverse `suggestions BookSuggestion[]` on `Book`. `npx prisma migrate dev --name book_suggestions` (owner; batch with the other two additive migrations). Gate: `migrate deploy` on a throwaway DB + tsc.

---

## Slice 2 — `enrichBook` composer + accept logic (agent-env, AUTO — buildable BEFORE the migration as pure functions)

**Files:** `src/lib/metadata/enrich.ts`, `tests/enrich.test.ts`.

- [ ] **`enrichBook(signalsSource, fetchImpl): Promise<MetadataSuggestion[]>`** — composes `parseFilenameSignals` → `searchOpenLibrary({fetchImpl})`, returns the ranked list (or `[]`). Pure but for the injected fetch. Test with a stub fetch returning canned OpenLibrary JSON: a messy filename yields ranked suggestions; a no-match yields `[]`; a thrown fetch yields `[]` (never throws).
- [ ] **`isThin(book): boolean`** (D-3a) — pure predicate over the extracted metadata. Test each branch (no isbn / title==fallback / no author).
- [ ] **`applyAcceptance(book, suggestion, { force }): Partial<Book>`** (D-3d) — pure function computing the field diff (empty-only unless `force`). Test: fills empty isbn; does NOT clobber a present title unless `force`; maps `subjects` → tag names.
  These three are fully agent-env and de-risk the owner's wiring session. Gate + commit: `feat(metadata): enrichBook composer + thin-check + acceptance diff (pure, dormant pipeline wired)`.

---

## Slice 3 — scan hook + review route (agent-env logic, gated behind Slice 1's table)

**Files:** `src/lib/scanner/index.ts` (call `enrichBook` for `isThin` new books, upsert `BookSuggestion` rows per D-3b/D-3e), `src/app/api/books/[id]/suggestions/route.ts` (GET pending), `src/app/api/books/[id]/suggestions/[sid]/route.ts` (POST accept → transactional write-back per D-3d, mark siblings rejected). Tests mirror the ephemeral-DB route seam.

- [ ] Scanner: after `book.create`, if `isThin`, `enrichBook` then create `BookSuggestion` rows (best-effort — a failed enrich never breaks the import, same contract as the lib). Update `tests/scanner.test.ts` with an injected fetch.
- [ ] Routes + tests (accept is transactional; siblings → rejected; write-back fills per policy).
- [ ] Gate (post-migration) + commit.

---

## Slice 4 — review/accept screen (HOST-VERIFY)

A "Suggestions" surface (per-book on the detail page + a library-wide review queue): show the ranked candidates with cover + confidence, accept / reject / force-overwrite, and **bulk-accept above a confidence slider** (D-3c). Host-verify the accept round-trip writes back and the badge clears.

---

## Self-review

- **Reuse integrity:** `parseFilenameSignals`, `searchOpenLibrary`, `MetadataSuggestion` (the lib interface), the `book.create` scan branch, and the `Book` write-back fields are all real shipped symbols (verified 2026-06-13). The DB model is deliberately named `BookSuggestion` to avoid shadowing the lib type.
- **Privacy/FOSS posture intact:** OpenLibrary only, network injected + best-effort, no Google.
- **Lane honesty:** the genuinely pure parts (Slice 2) are agent-env and buildable now; everything that needs the table or a browser is correctly gated. No silent auto-accept — metadata write-back stays a reviewed action (D-3c).
- **Companion to** `2026-06-13-relative-path-migration.md` (same schema window) and `2026-06-13-duplicate-detection.md` (D3's ISBN enrichment is what later sharpens the dupes grouping).
