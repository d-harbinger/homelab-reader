# TEACHING.md — homelab-reader

Per-project audit of AI-codegen slop, taught with **this repo's own code** as the
examples, then triaged into a cleanup plan. Part of the workspace library cleanup.

Each finding: **Tell** (what it looks like) · **Why** (why an AI does it) ·
**Detect** (a signal that can actually be run) · **Fix** (the surgical undo).

---

## Snapshot — 2026-06-10

- **What it is:** a self-hosted Next.js 15 book server — folder scanner (chokidar +
  in-house EPUB/PDF extractors), web readers (epub.js / PDF.js) with highlights, notes
  and progress, multi-user NextAuth credentials, and an OPDS catalog with per-user
  token auth feeding the sibling android-reader project.
- **Structure:** ~7.6k LOC TypeScript in `src/` (30+ API route handlers, 14 components,
  scanner + metadata libs) plus ~1.7k LOC of vitest suites in `tests/` (10 files,
  87 tests, real ephemeral SQLite DBs, committed fixtures).
- **git:** 99 commits over 2026-05-21 → 2026-06-02. Tree dirty with two one-line owner
  edits (CLAUDE.md / README.md path wording) — untouched by this audit. Privacy guard
  installed and active (`core.hooksPath` → `scripts/hooks`, gitleaks layer present).
- **Slop profile — clean core, slop at the edges.** The grep-level alarms
  (35 silent `catch {}`) mostly dissolve on reading: nearly every swallow carries a
  one-line reason (`/* transient */`, `/* race: file removed */`) and sits on a
  genuinely best-effort path. The real shape is **copy-paste scaffolding** — the same
  fetcher lambda in 8 components, the same Tailwind class strings in 7 files, the same
  try/catch boilerplate in ~15 route handlers, identical unused-import preambles in 4
  test files — plus a **pre-built feature layer (377 LOC + tests) that nothing imports
  yet**, left by an overnight autonomous run for a wiring session that hasn't happened.
- **Strengths (credit where due):** exceptional *why*-comments — load-bearing ordering
  is documented where it matters (path-before-hash resolution in
  `src/lib/scanner/index.ts`, the entire webpack/Edge-stub saga in `next.config.ts`
  including how each failure was reproduced); auth is centralized
  (`current-user.ts` / `reader-auth.ts` / `opds-auth.ts` with the Edge/Node split
  reasoned out in module comments); OPDS token hygiene is textbook (random 32-byte,
  SHA-256 at rest, shown once, constant-time confirm); a dedicated in-house promise
  limiter instead of a dependency; a real security audit doc
  (`docs/security-audit-2026-06-01.md`) whose HIGH finding was fixed with regression
  tests; thorough `.gitignore` and privacy infra from day one.

---

## Findings (ranked by leverage)

### 1. Pre-built, unwired feature layer — 377 LOC nothing imports  *(MODERATE — inventory risk)*

- **Tell:** `src/lib/metadata/openlibrary.ts` (190), `src/lib/metadata/citation.ts`
  (47), `src/lib/metadata/filename-signals.ts` (56), and
  `src/lib/library/folder-tree.ts` (84) are complete, tested modules — and not one
  file outside their own directories imports any of them. No route, no component, no
  scanner hook. Their 4 test suites pass; the features don't exist in the product.
- **Why:** an autonomous overnight run built the "pure core first" per
  `docs/superpowers/plans/2026-05-31-library-views-and-notes.md`, with wiring deferred
  to a next session. Each module is locally excellent; collectively they are shelfware
  until that session happens — and the OpenLibrary client in particular can rot
  silently against a live API while unwired.
- **Detect:** `grep -rln 'metadata/openlibrary\|metadata/citation\|filename-signals\|library/folder-tree' src | grep -v 'lib/metadata\|lib/library'` → empty.
- **Fix:** a decision, not a delete. Either run the wiring session the plan describes
  (read-only API routes + thin UI over the existing core), or consciously park it: note
  in the plan doc that the core is built-but-dormant so a future session doesn't
  rebuild it in parallel. Deleting tested, planned code would be the worse move.

### 2. Copy-paste scaffolding across client components  *(MODERATE — duplication)*

- **Tell:** `const fetcher = (url: string) => fetch(url).then((r) => r.json());`
  appears verbatim in **8 files** (`page.tsx`, `search/page.tsx`, and 6 components).
  The full input-field class string
  (`rounded-md border border-zinc-800 bg-zinc-900/60 px-3 py-2 … focus:border-amber-500/60 …`)
  recurs across **7 files**; icon-button and primary-button class strings likewise.
  There is no shared `Input`/`Button`/`fetcher` anywhere.
- **Why:** each component was generated fresh in its own session; an AI reaches for
  the idiom it knows rather than checking whether a sibling already defined it. The
  result reads fine per-file and drifts across files (the focus ring or disabled
  opacity already varies slightly between managers).
- **Detect:** `grep -rn 'const fetcher' src | wc -l` → 8;
  `grep -rln 'focus:border-amber-500/60' src | wc -l` → 7.
- **Fix:** lift the one-liner to `src/lib/fetcher.ts` (mechanical, 8 import edits) and,
  if the duplication keeps growing, extract two or three tiny presentational
  primitives (text input, icon button, primary button). Visual change must be
  host-verified in the browser — class-string consolidation can subtly alter styling.

### 3. Route-handler boilerplate repeated ~15×  *(MODERATE — duplication, minor ordering nit)*

- **Tell:** the same two blocks open almost every mutating handler: a
  `try { body = await req.json() } catch { return 400 "invalid json" }` (11 files) and
  a `try { await requireAdmin()/getCurrentUserId() } catch (e) { return authError(e) }`
  (15 files). Some handlers (notes/highlights/progress POST) also run the
  book-existence query *before* resolving auth — harmless today because the cookie
  middleware gates these routes, but the 404-before-401 ordering is the kind of
  invariant that silently breaks if a route is ever exempted the way
  `/api/books/[id]/file` was.
- **Why:** route files are generated one at a time from the previous route as the
  template; the helper (`authError`) was centralized but the *calling pattern* never
  was, so every new route re-pastes the ceremony.
- **Detect:** `grep -rln 'invalid json' src/app/api | wc -l` → 11;
  `grep -rl 'authError' src/app/api --include=route.ts | wc -l` → 15.
- **Fix:** two small helpers in `src/lib/`: `parseJson<T>(req)` returning a typed
  result-or-400, and a `withUser(handler)` / `withAdmin(handler)` wrapper that resolves
  auth *first* and passes the user in. Cuts ~100 lines, standardizes the auth-before-DB
  ordering for free, and the existing authz-gate tests pin the behavior. Do it as one
  mechanical pass, not opportunistically per-route.

### 4. Note↔highlight matching rule duplicated across surfaces  *(MINOR — fragile invariant)*

- **Tell:** "a note belongs to a highlight when their CFI strings are equal" is
  implemented independently in `HighlightsPanel.tsx:90` and `BookAnnotations.tsx:47-51`
  (and implicitly by the save path in `EpubReader.tsx`). The schema has no
  `Note.highlightId`; the panel's own comment calls the FK out as known future work.
- **Why:** the second surface (book-detail annotations) was built in a later session
  and re-derived the rule from the data shape instead of sharing it — classic
  cross-session drift; the two `find` predicates are already not character-identical.
- **Detect:** `grep -rn 'anchor.cfi === ' src/components` — two independent matchers.
- **Fix:** near-term, one shared helper (`notesByHighlight(highlights, notes)`) used by
  both surfaces. Long-term, the `Note.highlightId` column the comment already proposes
  — that is a schema migration and belongs to a planned change, not this cleanup.

### 5. Test-file preamble copy-paste — 13 lint warnings  *(MINOR — trivially safe)*

- **Tell:** `isolation.test.ts`, `opds-auth.test.ts`, `opds-tokens.test.ts`, and
  `scanner.test.ts` carry identical unused imports (`mkdtempSync`, `tmpdir`, `path`,
  `PrismaClient`) — the entire lint output (0 errors, 13 warnings) is this one
  copy-pasted preamble.
- **Why:** new suites are cloned from an existing suite's header; the unused imports
  ride along because nothing fails.
- **Detect:** `npm run lint` — all 13 warnings are `no-unused-vars` in `tests/`.
- **Fix:** delete the unused import lines. Zero risk; `npm test` re-proves it.

### 6. Docs drift — the docs describe a stack the code doesn't have  *(MINOR — docs only)*

- **Tell:** README ("epub2 + pdfjs-dist") and CLAUDE.md ("epub2 — server-side
  metadata") name a dependency that is not in `package.json` — EPUB extraction is
  actually in-house (`yauzl` + `fast-xml-parser` in `src/lib/scanner/epub.ts`).
  CLAUDE.md's architecture section lists `src/lib/reader/` which does not exist, and
  still labels the section "target — Phase 0 is just scaffold" on a repo that is 99
  commits past scaffold. README's last line is a stray duplicate `# homelab-reader`
  heading.
- **Why:** docs written at scaffold time describe the *intended* stack; later sessions
  changed the implementation and nobody returns to prose that doesn't fail a build.
  The stray heading is a botched append.
- **Detect:** `grep -n epub2 README.md CLAUDE.md package.json` — hits in docs, none in
  `package.json`; `tail -1 README.md`.
- **Fix:** one docs pass: correct the stack lists, prune or re-label the stale
  architecture block, drop the stray heading. **Both files currently carry uncommitted
  owner edits — coordinate so the pass doesn't collide with them.**

---

## Triage / cleanup plan

| # | Finding | Action | Status |
|---|---------|--------|--------|
| 1 | Unwired feature layer (377 LOC) | Decide: run the planned wiring session, or mark the core dormant in the plan doc | **in progress** — owner ruled WIRE IT (2026-06-10). Executed the library-views plan's auto-completable slices: Phase 0 (Dependabot patches via overrides — postcss/xmldom) + Phase 1 Task 1 (`/api/library/folders` route, TDD, session-gated + path-private). Gate green (89 tests/tsc/build). Remaining: Phase 1 Task 2 (folder-browser UI) is browser/host-verify — owner-gated; citation surface + remaining modules still dormant pending later phases |
| 2 | fetcher ×8 + Tailwind class soup ×7 | Lift `fetcher` to `src/lib/`; extract input/button primitives if growth continues; host-verify visuals | partial — fetcher lifted to `src/lib/fetcher.ts`, 8 sites rewired (tsc/lint/tests/build green); Tailwind class consolidation host-visual-gated, open |
| 3 | Route boilerplate ×15 | `parseJson` + `withUser`/`withAdmin` helpers in one mechanical pass; fixes auth-before-DB ordering as a side effect | open |
| 4 | CFI-matching rule ×2 | Shared `notesByHighlight` helper now; `Note.highlightId` migration as its own planned change | open |
| 5 | Test preamble unused imports | Delete 13 import lines; lint goes to zero | done — lint 0/0, tests 87/87 |
| 6 | Docs drift (epub2, `src/lib/reader/`, stray heading) | One docs pass, after the owner's in-flight README/CLAUDE.md edits land | open |

No emergency here. #5 is safe any time; #3 then #2 are the highest-leverage mechanical
passes (both fully covered by the existing gates); #1 is a product decision; #4 long-term
and #6 are small and should ride along with other work.

---

## Verification gate

Gates discovered from `package.json`, all run on 2026-06-10 after a fresh
`npm install` + `prisma generate` (the committed lockfile installed clean):

- `npx tsc --noEmit` — **pass** (clean).
- `npm test` (vitest) — **pass**, 10 files / 87 tests, against real ephemeral SQLite DBs.
- `npm run lint` — **pass**: 0 errors, 13 warnings (all finding #5).
- `npm run build` (production webpack build) — **pass**, all routes compiled.

Not verifiable from this audit environment, and therefore **not claimed**:

- **Reader behavior** — EPUB pagination/scroll, highlight painting, PDF scroll-window
  virtualization, selection popovers. Browser-only; needs a host-side run against a
  real library.
- **Scanner against a live folder** — chokidar watch, cold-start bulk import, the
  concurrency cap under load. Tests cover `scanFile` branches, not the watcher loop.
- **OPDS against a real client** — the contract is tested at the HTTP level, but an
  actual mobile-client (android-reader/KOReader) round-trip is a host gate.
- **Docker image** — `docker compose up` + entrypoint migration path; the standalone
  pdfjs tracing fix in `next.config.ts` claims container verification on 2026-06-01,
  not re-verified here.

Any "fixed/working" claim for findings #2 (visual) or #3 (route behavior) requires the
full gate set above plus a host-side smoke of the touched surface.
