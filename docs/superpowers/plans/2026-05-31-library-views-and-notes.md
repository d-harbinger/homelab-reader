# Library Views, Sorting & Notes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the self-sorting library visible and curatable — surface the on-disk shelves, let users switch "views" of the same books (Jellyfin-style), and turn reading annotations into portable notes + citations.

**Architecture:** Build on the pure, already-shipped core (`src/lib/metadata/*`, `src/lib/library/folder-tree.ts`). Wire it up host-side: read-only API routes that compose the core over Prisma data, then thin client UI. Folders are DERIVED from disk paths (no schema change); collections + views come later as additive layers. Everything FOSS, no Google (OpenLibrary only), notes Obsidian-first (pending confirmation).

**Tech Stack:** Next.js 15 App Router, Prisma/SQLite, NextAuth, TailwindCSS v4, Vitest (ephemeral-SQLite harness for route tests).

---

## Already built this session (REUSE — do not rebuild)

All on `main`, unit-tested, no DB/network:
- `src/lib/library/folder-tree.ts` → `buildFolderTree(books: {filePath}[], roots: string[]): FolderNode` (`{name, path, bookCount, totalCount, children}`).
- `src/lib/metadata/openlibrary.ts` → `searchOpenLibrary(query, opts): Promise<MetadataSuggestion[]>`, `scoreMatch(...)`. Ranked, no-Google.
- `src/lib/metadata/filename-signals.ts` → `parseFilenameSignals(filePath): EnrichQuery` (title + ISBN).
- `src/lib/metadata/citation.ts` → `formatReference(b)`, `formatBibtex(b)`.

## Decisions to bring to the session (BLOCKERS for later phases)

1. **Notes export target:** Obsidian/Markdown (assumed — user runs Loom on an Obsidian vault) vs Notion (API) vs Logseq. Gates Phase 3.
2. **Collections cardinality:** is a book in ONE shelf or MANY? (Phase 2 schema.) Default assumption: MANY (cross-cutting, Jellyfin-style).
3. **Security first:** 6 Dependabot alerts (5 high, 1 moderate) on the repo — triage before feature work (see Phase 0).

---

## Phase 0: Security triage (do first)

### Task 0: Resolve Dependabot alerts

**Files:** `package.json`, `package-lock.json`

- [ ] **Step 1: List the alerts**

Run: `gh api repos/d-harbinger/homelab-reader/dependabot/alerts --jq '.[] | select(.state=="open") | {pkg: .dependency.package.name, sev: .security_advisory.severity, fix: .security_vulnerability.first_patched_version.identifier}'`
Expected: 6 rows (5 high, 1 moderate) with package + first-patched version.

- [ ] **Step 2: Bump the flagged packages**

For each: `npm install <pkg>@<first-patched-version>` (prefer minor/patch; if a major bump is required, note it and verify the build separately).

- [ ] **Step 3: Verify nothing broke**

Run: `npm test && npx tsc --noEmit && npm run build`
Expected: 81+ tests pass, tsc exit 0, build "Compiled successfully".

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore(deps): patch Dependabot-flagged vulnerabilities"
```

---

## Phase 1: Shelf/Folder view (the visible win)

Surface the python/ai/… shelves the user already has on disk. Read-only; no schema change.

### Task 1: `/api/library/folders` route

**Files:**
- Create: `src/app/api/library/folders/route.ts`
- Test: `tests/library-folders.test.ts`

**Pattern to mirror:** `src/app/api/scan/failures/route.ts` (session gate via `getCurrentUser`/`authError`, `NextResponse.json`). **Privacy:** return only the relative tree from `buildFolderTree` (folder names) — NEVER full filePaths (home-dir paths must not reach the client).

- [ ] **Step 1: Write the failing test** (mirror the `vi.hoisted` ephemeral-DB + `vi.mock("@/auth")` setup from `tests/scanner.test.ts` lines 30–56)

```ts
// tests/library-folders.test.ts (header/hoisted block copied from scanner.test.ts)
import { asReader } from "./helpers/auth-mock";
import { makeTestDb, seedTwoUsers } from "./helpers/test-db";
// ... hoisted prisma + vi.mock("@/lib/prisma") + vi.mock("@/auth") as in scanner.test.ts ...
import { GET } from "@/app/api/library/folders/route";

it("returns a folder tree derived from book paths under the scan root", async () => {
  await h.prisma.scanLocation.create({ data: { path: "/books" } });
  for (const fp of ["/books/python/a.epub", "/books/python/web/b.epub", "/books/ai/c.epub"]) {
    await h.prisma.book.create({ data: { filePath: fp, format: "epub", title: fp } });
  }
  asReader(); // authenticated session
  const res = await GET();
  const body = await res.json();
  expect(res.status).toBe(200);
  expect(body.tree.totalCount).toBe(3);
  expect(body.tree.children.map((c: { name: string }) => c.name)).toEqual(["ai", "python"]);
  // privacy: no absolute path anywhere in the payload
  expect(JSON.stringify(body)).not.toContain("/books");
});

it("401s an unauthenticated request", async () => {
  // (no asReader) -> auth() returns null
  const res = await GET();
  expect(res.status).toBe(401);
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run tests/library-folders.test.ts`
Expected: FAIL — `Cannot find module "@/app/api/library/folders/route"`.

- [ ] **Step 3: Implement the route**

```ts
// src/app/api/library/folders/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser, authError, UnauthenticatedError } from "@/lib/current-user";
import { buildFolderTree } from "@/lib/library/folder-tree";

// GET /api/library/folders — the on-disk shelf tree. Session-gated. Returns only
// relative folder names (buildFolderTree strips the scan root); full filesystem
// paths (home-dir paths on a homelab) never reach the client.
export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) return authError(new UnauthenticatedError());
    const [books, locations] = await Promise.all([
      prisma.book.findMany({ select: { filePath: true } }),
      prisma.scanLocation.findMany({ where: { enabled: true }, select: { path: true } }),
    ]);
    const tree = buildFolderTree(books, locations.map((l) => l.path));
    return NextResponse.json({ tree });
  } catch (e) {
    return authError(e);
  }
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `npx vitest run tests/library-folders.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/app/api/library/folders/route.ts tests/library-folders.test.ts
git commit -m "feat(library): /api/library/folders — derived on-disk shelf tree (session-gated, path-private)"
```

### Task 2: Folder browser UI on the library page

**Files:**
- Create: `src/components/FolderTree.tsx` (recursive sidebar; expand/collapse; shows `totalCount` per shelf; selecting a folder sets a `?folder=python/web` filter)
- Modify: `src/app/page.tsx` (fetch `/api/library/folders` via SWR; render `<FolderTree>` in a left rail; filter the book grid by the selected folder prefix)

> **Note:** client-only React — verify by rebuild + browser (host-side), not Vitest. Keep `FolderTree.tsx` presentational and small; data comes from the route in Task 1.

- [ ] **Step 1:** Build `FolderTree.tsx` consuming the `FolderNode` shape from `@/lib/library/folder-tree`; render `children` recursively with disclosure triangles and `totalCount` badges; `onSelect(path: string)` callback.
- [ ] **Step 2:** In `page.tsx`, add `useSWR<{tree: FolderNode}>("/api/library/folders")`, render the rail, and filter the existing book grid where `book.filePath` (or a derived `folder` field) starts with the selected `path`. (Books already come from `/api/books`; filter client-side for v1.)
- [ ] **Step 3:** Rebuild host-side; confirm the python/ai shelves appear and selecting one filters the grid.
- [ ] **Step 4: Commit** `git commit -m "feat(library): folder-tree sidebar + folder filter on the library page"`

**Phase 1 done = the wall becomes shelves.** Stop, let the user dogfood, then proceed.

---

## Phase 2: Views switcher + Collections (own plan — expand when reached)

The "views by mood" + Jellyfin-style cross-cutting curation. Outline:

- **Schema (needs `npx prisma migrate dev --name collections`):** `Collection { id, name, userId, createdAt }` + implicit `Book[] <-> Collection[]` join. Per-user. (Confirm cardinality decision #2 first.)
- **Views as a lens enum** over the same books: `shelf` (Task-1 tree), `topic` (group by `Tag`/OpenLibrary subjects), `author`, `recent` (`addedAt`), `reading` (join `Progress`). A `<ViewSwitcher>` sets the active lens; each lens is a grouping function over the book list (mirror `buildFolderTree`'s pure-function style — testable).
- **Home rows** (Jellyfin layout): the existing `page.tsx` already has Continue/Recent/tag `Section`s — generalize to configurable rows per active view.
- **API:** `/api/collections` CRUD (session-gated, per-user); add/remove book ↔ collection.

Each bullet becomes a TDD task in `docs/superpowers/plans/<date>-views-collections.md`.

## Phase 3: Notes + citations export (own plan — BLOCKED on decision #1)

Turn highlights/notes into portable notes + references. Outline:

- **Citation surface:** on the book detail page, a "Cite" action calling `formatReference`/`formatBibtex` (already built) — copy-to-clipboard + `.bib` download. (Pure; testable now — could pull forward.)
- **Annotation export:** for each book (or all), render highlights+notes to Markdown with frontmatter (title/author/ISBN), a quote block, the user's note, and a precise locator (CFI/page). Module `src/lib/notes/markdown-export.ts` — pure, TDD-able in-VM.
- **Delivery (DECISION #1):** Obsidian → write `.md` files into a configured vault path (or download a bundle); Notion → API; Logseq → Markdown blocks. Build the Markdown module first (target-agnostic), wire delivery after the decision.
- **Enrich-on-import (the Loom pattern):** compose `parseFilenameSignals` → `searchOpenLibrary` → store ranked suggestions on scan; a confidence-review screen to accept/bulk-accept. (Larger — may be its own plan.)

---

## Self-review notes

- **Spec coverage:** Phase 1 fully covers "shelves from disk" (the immediate ask). Views/collections (Jellyfin) → Phase 2; robust notes/citations/Obsidian → Phase 3; both flagged as separate plans with concrete starting tasks. Security → Phase 0.
- **Reuse integrity:** function/type names (`buildFolderTree`, `FolderNode`, `searchOpenLibrary`, `formatReference`/`formatBibtex`, `parseFilenameSignals`) match the shipped modules.
- **Open placeholders are intentional** and confined to Phases 2–3, which are explicitly "expand into own plan," not executable steps — Phase 0–1 are placeholder-free and runnable as-is.
