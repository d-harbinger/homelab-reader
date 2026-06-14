# Root-Relative Book Paths — Migration Plan (OWNER-PRESENT)

> **For agentic workers:** This plan is **NOT dispatchable to an unattended executor.** Every slice is owner-gated: it requires `npx prisma migrate dev` (schema-mutating, irreversible against a real DB) and the owner's presence. A grave/night run may only REFINE this plan, never execute it.

**STATUS:** PENDING (owner-present) · valid-as-of 2026-06-13
**Value:** M-H — `Book.filePath` is absolute AND the unique key, so the *same library at a different mount* (dev vs container, a machine move) creates fresh `Book` rows and **orphans the annotations/highlights/progress** anchored to the old rows. The interim convention (one env-injected root per machine; the server is the library of record) contains the blast radius but does not fix dev/container interop. This makes location identity root-relative so the same shelf is the same book everywhere.

**Goal:** Identify a book by *(which scan location, path relative to that location)* instead of an absolute path, so the library is portable across mounts without losing notes.

**Schema window:** Per the queue, run this in the **same owner session** as the companion schema changes so the library only migrates once:
- **D3 suggestions table** (`MetadataSuggestion` — enrich-on-import review queue) — see `2026-06-13-reader-annotation-ux.md` is *separate*; the D3 table is sketched in §"Companion migrations" below.
- **`Note.highlightId`** (TEACHING #4 — pair a note to a highlight by FK, not CFI equality) — sketched in `2026-06-13-reader-annotation-ux.md`.
This plan owns ONLY the relative-path change; the companions are cross-referenced so the owner batches the `migrate dev` calls.

---

## Load-bearing assumptions (field 8 — verify BEFORE any migration)

1. **`Book.filePath String @unique`** is the current identity; `ScanLocation.path String @unique` is the root set.
   `grep -nE "filePath|model ScanLocation|path " prisma/schema.prisma`
2. **Every consumer of `filePath`** must be enumerated before changing it — the blast radius:
   `grep -rn "filePath" src/ tests/` — expect hits in: `scanner/index.ts` (resolve-by-path, repoint), `scanner/watcher.ts`, `api/books/route.ts` (folder filter + new genre derivation), `api/library/folders/route.ts`, `lib/library/folder-tree.ts` (`relativeFolder`/`buildFolderTree`), `api/covers`, `api/books/[id]/file`, `scanner/failed-imports.ts` (`FailedImport.filePath` — separate, leave it absolute), the tests for each.
3. **`relativeFolder(filePath, roots)`** already computes "path under the longest matching root" — the backfill reuses this exact rule so the tree and the stored relPath can never disagree.
   `grep -n "export function relativeFolder" src/lib/library/folder-tree.ts`
4. **chimera/homelab migration discipline** = `prisma migrate deploy` runs automatically on boot (entrypoint + predev); migrations are committed SQL, never `db push`. Confirm: `ls prisma/migrations` shows dated dirs + `migration_lock.toml`.

Any divergence → STOP; re-derive the consumer list from the live grep, not this list.

---

## Decisions to bring (field 4 — defaults; these are real schema commitments, so owner confirms each)

- **D-B1 · Identity = `(scanLocationId, relPath)` composite unique.** Default: **yes.** Add `scanLocationId String` FK → `ScanLocation` and `relPath String` (path under that location's root, no leading slash). Replace `@@unique`/`@unique` on `filePath` with `@@unique([scanLocationId, relPath])`.
- **D-B2 · Keep an absolute `filePath`?** Default: **drop it as the key, keep it as a derived non-unique convenience column** populated by the scanner (`location.path + "/" + relPath`) — avoids rewriting `covers`/`file` routes that read an absolute path, while the *identity* moves to the composite. (Alternative: drop the column entirely and reconstruct on read — cleaner schema, larger diff. Default favors the smaller, safer diff.)
- **D-B3 · Books under NO scan location.** Default: there should be none (the scanner only ingests files under a root), but the backfill must handle a stray: **leave it on a synthetic `__unrooted__` location** and log it for the owner, rather than dropping the row (which would orphan notes — the exact failure we're fixing).
- **D-B4 · Backfill = code script, not raw SQL.** Default: **yes** — a one-shot `scripts/backfill-relpaths.mjs` that loads books + locations, applies `relativeFolder`, and writes `scanLocationId`+`relPath`, run by the owner AFTER `migrate dev` adds nullable columns and BEFORE a second migration makes them required. (Prisma's two-step pattern for a non-null column on existing data.)
- **D-B5 · Scanner rewrite.** Default: `scanFile` resolves by `(scanLocationId, relPath)` instead of `filePath`; the move/repoint logic (hash match) and the crash-safe ordering are preserved, just keyed on the composite. The hash-converge behavior (and its known sharp edge) is unchanged by this plan.

---

## Migration shape (owner runs each `migrate dev`; an executor may not)

**Two-phase, because the columns become required on populated data:**

1. **Phase 1 — additive (`prisma migrate dev --name relpath_add_nullable`):**
   ```prisma
   model Book {
     // … existing fields …
     filePath       String   @unique   // becomes non-unique convenience in phase 3
     scanLocationId String?            // nullable in phase 1
     relPath        String?            // nullable in phase 1
     scanLocation   ScanLocation? @relation(fields: [scanLocationId], references: [id])
     @@index([scanLocationId])
   }
   model ScanLocation {
     // … existing …
     books Book[]
   }
   ```
2. **Phase 2 — backfill (`node scripts/backfill-relpaths.mjs`):** populate `scanLocationId`+`relPath` for every row via `relativeFolder`; report any `__unrooted__`.
3. **Phase 3 — tighten (`prisma migrate dev --name relpath_require_and_rekey`):** make `scanLocationId`+`relPath` required, drop `@unique` on `filePath`, add `@@unique([scanLocationId, relPath])`.

Each phase is its own committed migration; the owner runs them in order, verifying row counts between phases.

---

## Code-change slices (ALL owner-gated — listed so the owner session is mechanical)

Order: schema+backfill first, then consumers, each with its test updated. None auto-runnable (all sit behind a migrated DB).

- [ ] **B-1** Phase-1 migration + nullable schema. Gate: `prisma migrate deploy` on a throwaway DB succeeds; `tsc` green.
- [ ] **B-2** `scripts/backfill-relpaths.mjs` + a Vitest over an ephemeral DB asserting backfill correctness (reuse the `tests/library-folders.test.ts` seam: seed absolute-path books + a location, run the backfill fn, assert `relPath`/`scanLocationId`). **This test IS agent-env** — the backfill *logic* can be TDD'd in-environment even though *applying* it to the real DB is owner-gated. Build the tested function now if early; gate the real run.
- [ ] **B-3** Phase-3 migration (required + re-key).
- [ ] **B-4** Scanner: resolve + repoint by composite (D-B5); update `tests/scanner.test.ts`.
- [ ] **B-5** Consumers: `api/books` folder filter + genre derivation, `folder-tree`/`relativeFolder` callers, `covers`/`file` routes — switch to the stored `relPath`/derived `filePath` per D-B2; update each test.
- [ ] **B-6** Full suite + `tsc` + build green; owner host-verifies the library still lists, opens, and keeps notes across a simulated remount.

> **Note the one agent-env island:** B-2's backfill *function* is unit-testable tonight. If the construction tail has budget, building+testing `backfillRelpaths(books, locations)` as a pure function (no DB write) is legitimate agent-env work that de-risks the owner session. The DB application stays owner-gated.

---

## Companion migrations (same owner schema window — sketches, own plans)

- **`Note.highlightId String?` FK → `Highlight`** (TEACHING #4): pairs a note to a highlight explicitly instead of by CFI equality; unblocks the add-note-on-highlight flow in `2026-06-13-reader-annotation-ux.md`. Additive, nullable — single `migrate dev`.
- **`MetadataSuggestion` table (D3):** `{ id, bookId FK, source, confidence, title, authors(json), isbn, subjects(json), coverUrl, workKey, status: "pending"|"accepted"|"rejected", createdAt }` — the review queue the dormant `parseFilenameSignals → searchOpenLibrary` pipeline writes into. Its own plan (enrich-on-import); listed here only so the owner cuts ONE schema window.

---

## Self-review

- **Correctly owner-gated:** the irreversible part (`migrate dev` on a real library) never runs unattended; only the backfill *logic* is offered as optional agent-env de-risking.
- **No orphaned notes:** the `__unrooted__` fallback (D-B3) refuses to drop a row, directly serving the bug's intent.
- **Reuse integrity:** `relativeFolder` is the single source of the strip-root rule for both the tree and the stored `relPath` — they cannot drift.
- **Batched window:** companions cross-referenced so the library migrates once, not three times.
