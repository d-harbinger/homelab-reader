# Finishing pass — close every agent-env TEACHING item

**STATUS: DONE** (valid-as-of 2026-06-10)
All six slices landed on `main`: A `3dceb07`/merge `56d9fe6`, B `ab51316`/merge
`44e5a43`, C `30ce5d0`, D `9e64855`, E `82d1fbe`, F (this close-out). Final gates:
vitest 125/125 (17 files), tsc 0, lint 0/0, build green. Only owner-gated items
remain (D1–D4, host visuals, TEACHING #2 Tailwind consolidation).
**value: H** — completes the project's agent-env work in one focused run: the
"wire it up" ruling's remaining slices plus TEACHING #3/#4/#6. After this pass
the repo's only open items are owner-gated (D1–D4 decisions, host visuals,
TEACHING #2 Tailwind consolidation).
**Cross-repo writes: none** — all slices land in homelab-reader on `main`.

Companion to `2026-06-10-library-wiring-phase2.md` (its slices 3–4 are slices
A–B here; its slices 1–2 landed as `1494356`/`12968d4`).

## Load-bearing assumptions — verified live 2026-06-10 before writing

1. Suite baseline **109/109** across 14 files; tsc 0; lint 0 (re-verify before
   the first slice: `npx vitest run 2>&1 | grep Tests`).
2. TEACHING #3 counts have ROTTED UPWARD since the audit: now **11** files with
   the `invalid json` block and **18** routes importing `authError` (audit said
   15; the folders + annotations + citation routes joined the class). The
   mechanical pass covers the live 18, including the three newest routes.
   Check: `grep -rl 'authError' src/app/api --include=route.ts | wc -l` → 18.
3. TEACHING #4 matcher sites: `src/components/HighlightsPanel.tsx:90` (note
   lookup) and `src/components/BookAnnotations.tsx:47-49` (lookup AND the
   inverse orphan-note predicate). The helper must cover both directions.
   Check: `grep -rn 'anchor.cfi === ' src/components`.
4. TEACHING #6 targets: `epub2` named in CLAUDE.md (×2: stack list, scanner
   line) + README (×1); real extractors are `yauzl` + `fast-xml-parser` in
   `src/lib/scanner/epub.ts` (verify: `grep -n 'yauzl\|fast-xml-parser'
   src/lib/scanner/epub.ts package.json`); `src/lib/reader/` does not exist;
   README's last line is a stray duplicate `# homelab-reader` heading. The
   audit's "uncommitted owner edits" warning is STALE — tree is clean, the
   owner's docs edits landed (`dd89dc5`).
5. Wiring-plan assumptions 7–8 (no `filePath` in `/api/books` responses;
   `buildFolderTree`/`FolderNode` exports) — re-run from that plan.

## Slices

### Slice A (auto · agent-env code; visual host-verify owed) — wiring slice 3
As specified in `2026-06-10-library-wiring-phase2.md` slice 3 (server-side
`folder` param on `/api/books` + `FolderTree.tsx` rail + `page.tsx` wiring).
Gates: new route test green · full suite green · tsc 0 · lint 0 new · build
green. Runs in a worktree, parallel with slice B (different files; the only
shared file risk is none — A touches `src/app/api/books/route.ts`,
`src/components/FolderTree.tsx`, `src/app/page.tsx`; B touches
`src/app/books/[id]/page.tsx` only).

### Slice B (auto · agent-env code; visual host-verify owed) — wiring slice 4
As specified in the wiring plan slice 4 (detail-page Cite + Export actions).
Gates: tsc 0 · lint 0 new · build green. Worktree, parallel with A.

### Slice C (auto · agent-env) — TEACHING #3: route-handler helpers, one mechanical pass
After A+B merge (C rewrites the routes A touched). Two helpers in `src/lib/`:

- `parseJson<T>(req: Request): Promise<{ ok: true; body: T } | { ok: false; res: NextResponse }>`
  — replaces the 11 inline `try { await req.json() } catch { 400 }` blocks.
- `withUser(handler)` / `withAdmin(handler)` wrappers resolving auth FIRST and
  passing the user/admin in — replaces the per-route auth ceremony across all
  18 routes and standardizes auth-before-DB ordering (the 404-before-401 nit).

TDD: a `tests/route-helpers.test.ts` unit-tests both helpers directly (branch
enumeration in the header: valid json · invalid json 400 · authed · unauthed
401 · admin vs non-admin 403 · auth-before-body ordering). Then the mechanical
migration, route by route, in ONE commit; the existing authz-gate +
route tests pin behavior (suite must stay green with zero assertion edits —
if a route test needs its assertion changed, STOP: that is a behavior change,
not a refactor). Gates: full suite green (echo count; 109 + new helper tests)
· tsc 0 · lint 0 new · `grep -rln 'invalid json' src/app/api | wc -l` → 0 ·
LOC delta echoed (expect roughly −100).

### Slice D (auto · agent-env) — TEACHING #4: shared annotation-matching helper
`src/lib/annotations.ts` (or extend an existing lib module if a better home
exists — read first): `notesByHighlight(highlights, notes)` and
`orphanNotes(highlights, notes)` implementing the CFI-equality rule once.
TDD (branches: match · no-match · null/absent cfi — note BookAnnotations
guards `n.anchor.cfi &&` while HighlightsPanel does not; the helper adopts the
GUARDED form and the test pins it). Rewire both components. NO schema change
(`Note.highlightId` stays future work, per the finding). Gates: full suite
green · tsc 0 · lint 0 new · `grep -rn 'anchor.cfi === ' src/components` → 0.

### Slice E (auto · agent-env) — TEACHING #6: docs-truth pass
One pass over README.md + CLAUDE.md: stack lists say `yauzl` +
`fast-xml-parser` (in-house EPUB extraction) and pdfjs-dist; remove the
`src/lib/reader/` phantom from the architecture block and re-label it as
current architecture (not "target/scaffold"); drop README's stray trailing
heading; add the four new API surfaces (folders, folder filter, annotations
export, citation) to whatever route list the docs keep. Gates:
`grep -n epub2 README.md CLAUDE.md` → 0 hits · `tail -1 README.md` is not a
bare heading · privacy hook clean.

### Slice F (auto · agent-env) — close the books
Update TEACHING.md: triage rows #1 (wired — final state), #3, #4, #6 → done
with the why preserved; add a "What I did — finishing pass — and why" section
per the TEACHING convention (legible reasoning, it feeds the owner's bionic
learning pass); update the wiring plan + this plan's STATUS headers to DONE;
verification-gate section updated with the final numbers. Gates: full suite +
tsc + lint + build one last time, numbers echoed into TEACHING.

## Decisions to bring (morning)
Unchanged from the wiring plan (D1–D4). Slice C introduces none (pure
refactor pinned by tests); if it surfaces a behavioral discrepancy it STOPs.

## Definition of done
All six slices committed atomically on `main`; only owner-gated items remain
open in TEACHING (D1–D4, host visuals, #2 Tailwind); queue + AUDIT-PROGRESS
flipped; suite/tsc/lint/build all green at close, numbers in TEACHING.
