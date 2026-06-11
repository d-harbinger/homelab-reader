# Library wiring, phase 2 — citation + notes-export surfaces, folder browser

**STATUS: PENDING** (valid-as-of 2026-06-10)
**value: H** — executes the 2026-06-10 owner ruling on TEACHING finding #1 ("wire it
up"): three of the four dormant tested modules (`citation`, `notes/markdown-export`,
`library/folder-tree`) gain product surface. `metadata/openlibrary` +
`filename-signals` stay deliberately dormant pending the enrich-on-import decision
(D3 below).
**Cross-repo writes: none** — every slice lands in homelab-reader on `main`
(routine work; the repo is not a live deploy).

Successor to `2026-05-31-library-views-and-notes.md` (Phase 0 + Phase 1 Task 1 +
the Phase 3 markdown-export core are DONE on main — `2fe506f`, `0158168`,
`8c85016`). This plan covers the remaining wiring that is buildable without a
schema migration or an owner decision. Phase 2 (views/collections) still needs
`prisma migrate dev` + decision D2 and remains its own future plan.

## Load-bearing assumptions — verify against current code before building

Run each check; a mismatch is a STOP-and-report, not a guess:

1. `exportAnnotationsMarkdown(input: ExportInput): string` exists with
   `ExportInput = { book: ExportBook; highlights: ExportHighlight[]; notes: ExportNote[] }`
   — `grep -n 'export function exportAnnotationsMarkdown\|export interface ExportInput' src/lib/notes/markdown-export.ts`
2. `formatReference(b: CitationInput)` / `formatBibtex(b: CitationInput)` exist with
   `CitationInput = { title?, authors: string[], publishedYear?, publisher?, isbn? }`
   — `grep -n 'export function format\|export interface CitationInput' src/lib/metadata/citation.ts`
3. Route auth pattern: `getCurrentUser` / `authError` / `UnauthenticatedError` from
   `@/lib/current-user`, used exactly as in `src/app/api/library/folders/route.ts`
   (the pattern exemplar) — `grep -n 'getCurrentUser\|authError' src/lib/current-user.ts`
4. Test pattern: `vi.hoisted` ephemeral DB + `vi.mock("@/auth")`, as in
   `tests/library-folders.test.ts` and `tests/notes-markdown-export.test.ts`.
5. **Book model has `publishedAt DateTime?`, NOT `publishedYear`** — the citation
   route derives `publishedYear: book.publishedAt?.getFullYear()`. Authors come
   through the `authors` relation (`{ name }` rows)
   — `grep -n 'publishedAt\|publisher\|isbn' prisma/schema.prisma | head`
6. `Note` and `Highlight` are per-user (`userId`), carry `anchor` as a JSON string,
   and **`Note` has NO `highlightId`** — notes are independent annotations; the
   exporter already treats them so. Never invent a join
   — `grep -n -A6 'model Note ' prisma/schema.prisma`
7. **`/api/books` does NOT expose `filePath`** (deliberate privacy posture: absolute
   paths never reach the client; the folders route strips scan roots for the same
   reason). The original Task-2 idea of client-side `filePath` filtering is
   therefore stale — folder filtering must happen server-side (slice 3)
   — `grep -n 'filePath' src/app/api/books/route.ts` → only inside the handler if at all, never in the response map.
8. `buildFolderTree(books, roots)` + `FolderNode {name, path, bookCount, totalCount, children}`
   from `@/lib/library/folder-tree`
   — `grep -n 'export' src/lib/library/folder-tree.ts`

## Decisions to bring (morning batch — defaults attached, all yes/no)

- **D1 — notes-export delivery target** (old plan's decision #1): default =
  **in-app Markdown download** (target-agnostic; what slices 1+4 ship). Obsidian
  vault-write becomes its own later slice only if the owner wants it; Notion/Logseq
  dropped unless requested.
- **D2 — collections cardinality** (gates the Phase-2 views/collections plan):
  default = **MANY** (cross-cutting, Jellyfin-style). No schema work in this plan
  either way.
- **D3 — enrich-on-import** (`openlibrary` + `filename-signals` wiring): needs a
  schema home for ranked suggestions → `prisma migrate dev` → owner-present work.
  Default = **keep dormant with this note as the marker**; blueprint it as its own
  plan after D2 rules.
- **D4 — server-side folder filter** (consequence of assumption 7): default =
  **accept** the `folder` query-param design in slice 3; the alternative (shipping
  a derived relative-folder field per book) widens the payload for no gain.

## Slices (in order; 1–2 fully agent-env; 3–5 agent-env code gates + host-verify owed)

### Slice 1 (auto · agent-env) — `GET /api/books/[id]/annotations.md` — Markdown export route

TDD, test first (`tests/annotations-export-route.test.ts`), mirroring the
`vi.hoisted` ephemeral-DB + `vi.mock("@/auth")` setup of
`tests/library-folders.test.ts`. The test header comment enumerates every branch
the route introduces (branch-coverage rule): 401 signed-out · 404 unknown book ·
200 happy path with highlights+notes · **per-user isolation** (another user's
annotations never appear) · empty-annotations book still 200 with header-only doc.

Route `src/app/api/books/[id]/annotations/route.ts`:

```ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  getCurrentUser,
  authError,
  UnauthenticatedError,
} from "@/lib/current-user";
import { exportAnnotationsMarkdown } from "@/lib/notes/markdown-export";

// GET /api/books/[id]/annotations — the signed-in user's highlights + notes for
// one book as a portable Markdown document (Content-Disposition: attachment).
// Per-user: only the requesting user's annotations are exported.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await getCurrentUser();
    if (!user) return authError(new UnauthenticatedError());
    const { id } = await params;

    const book = await prisma.book.findUnique({
      where: { id },
      include: { authors: true },
    });
    if (!book) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const [highlights, notes] = await Promise.all([
      prisma.highlight.findMany({ where: { bookId: id, userId: user.id } }),
      prisma.note.findMany({ where: { bookId: id, userId: user.id } }),
    ]);

    const markdown = exportAnnotationsMarkdown({
      book: {
        title: book.title,
        authors: book.authors,
        isbn: book.isbn,
        format: book.format,
      },
      highlights,
      notes,
    });

    const slug = book.title.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "") || "book";
    return new NextResponse(markdown, {
      headers: {
        "Content-Type": "text/markdown; charset=utf-8",
        "Content-Disposition": `attachment; filename="${slug}-annotations.md"`,
      },
    });
  } catch (e) {
    return authError(e);
  }
}
```

**Gate:** `npx vitest run tests/annotations-export-route.test.ts` green → full
suite green (run count echoed) → `npx tsc --noEmit` 0 errors. Commit:
`feat(notes): per-user Markdown annotations export route`.

### Slice 2 (auto · agent-env) — `GET /api/books/[id]/citation` — citation route

TDD, test first (`tests/citation-route.test.ts`), same harness. Branches
enumerated in the header: 401 · 404 · 200 with full metadata · 200 with sparse
metadata (no publisher/year/isbn — formatter omits, never emits blanks).

Route `src/app/api/books/[id]/citation/route.ts` returns JSON
`{ reference: string, bibtex: string }` (client handles copy/download):

```ts
const citationInput = {
  title: book.title,
  authors: book.authors.map((a) => a.name),
  publishedYear: book.publishedAt?.getFullYear(),
  publisher: book.publisher ?? undefined,
  isbn: book.isbn ?? undefined,
};
return NextResponse.json({
  reference: formatReference(citationInput),
  bibtex: formatBibtex(citationInput),
});
```

Auth/404 scaffold identical to slice 1. **Gate:** new test green → full suite
green → tsc 0. Commit: `feat(metadata): citation route over formatReference/formatBibtex`.

### Slice 3 (auto code · agent-env gates; visual host-verify owed) — folder filter, server side

Two steps, one commit:

1. `/api/books` gains an optional `folder` query param (D4): when present, the
   route additionally fetches `prisma.scanLocation.findMany({ where: { enabled: true } })`,
   computes each candidate book's root-relative folder (`filePath` starts with a
   root → strip root + leading separator), and filters to books whose relative
   path starts with the requested folder. Absolute paths never enter the
   response — the param compares server-side only. Extend
   `tests/library-folders.test.ts` patterns into `tests/books-folder-filter.test.ts`:
   branches = no param (unchanged response) · folder matches subset · folder
   matches nothing (empty list, 200) · folder with nested subpath.
2. `FolderTree.tsx` (new, `src/components/`) consuming `FolderNode` from
   `@/lib/library/folder-tree` via `useSWR("/api/library/folders")` — recursive
   disclosure triangles, `totalCount` badges, `onSelect(path)`. `page.tsx` renders
   the rail and re-queries `/api/books?folder=<path>` on select. Reuse the shared
   `fetcher` from `src/lib/fetcher.ts` (TEACHING #2 lift) — do not re-inline it.

**Gate:** new route test green → full suite green → tsc 0 → `npm run lint` 0 new
→ `npm run build` green. The rendered rail is served/dynamic UI — `devtools
visual-check` does NOT cover it; log "folder rail renders + filters" on the
host-verify list. Commit: `feat(library): folder rail + server-side folder filter`.

### Slice 4 (auto code · agent-env gates; visual host-verify owed) — detail-page Cite + Export actions

On `src/app/books/[id]/page.tsx`: a "Cite" action (fetch `/api/books/[id]/citation`,
copy-to-clipboard for reference, download for `.bib`) and an "Export annotations"
action (link to `/api/books/[id]/annotations`). Match the page's existing button
idiom — read the file first; no new component library, no class-soup additions
(TEACHING #2). No new tests (the routes carry the logic; the page change is
declarative wiring). **Gate:** tsc 0 → lint 0 new → build green; visual on the
host-verify list. Commit: `feat(books): cite + export-annotations actions on the detail page`.

### Slice 5 (STOP — owner) — ratify decisions + host-verify checklist

Bring D1–D4 with defaults; hand over the host-verify checklist: folder rail
renders/filters (slice 3), Cite copies + `.bib` downloads, annotations export
downloads with real annotations (slice 4) — all on the host dev server.

## Definition of done

Slices 1–4 committed atomically on `main`, every gate echoed pass/fail in the
executor reports; TEACHING.md triage row #1 updated (citation + export + folder
surfaces wired; openlibrary/filename-signals dormant pending D3); the
DAYSHIFT-QUEUE entry flipped DONE-except-STOP with the host-verify list attached.
