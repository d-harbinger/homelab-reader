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
| 1 | Unwired feature layer (377 LOC) | Decide: run the planned wiring session, or mark the core dormant in the plan doc | **done — 2026-06-10.** Owner ruled WIRE IT. Three of the four dormant modules now have product surface: `library/folder-tree` (folders route + folder rail + server-side folder filter), `notes/markdown-export` (annotations export route + detail-page Export action), `metadata/citation` (citation route + detail-page Cite action). `metadata/openlibrary` + `filename-signals` stay **deliberately dormant** — they need a schema home for ranked import suggestions, which is owner decision D3; the plan doc carries that marker so a future session does not rebuild them. The shelfware risk is closed for everything buildable without a migration |
| 2 | fetcher ×8 + Tailwind class soup ×7 | Lift `fetcher` to `src/lib/`; extract input/button primitives if growth continues; host-verify visuals | **partial — 2026-06-10.** Fetcher lifted to `src/lib/fetcher.ts`, 8 sites rewired (tsc/lint/tests/build green); the new folder rail reuses it rather than re-inlining. Tailwind class consolidation stays open — it can subtly alter styling and is host-visual-gated, which this environment cannot run |
| 3 | Route boilerplate ×15 | `parseJson` + `withUser`/`withAdmin` helpers in one mechanical pass; fixes auth-before-DB ordering as a side effect | **done — 2026-06-10.** `parseJson<T>` in `src/lib/parse-json.ts` and `withUser`/`withAdmin` in `src/lib/route-helpers.ts`, both unit-tested directly, then a single mechanical pass over 19 route handlers (the class had rotted upward from the audit's 15). Route files net **−250 LOC**; auth now resolves before any DB read everywhere, standardizing the auth-before-DB ordering for free. Existing authz-gate + route tests pinned behavior — zero assertion edits |
| 4 | CFI-matching rule ×2 | Shared `notesByHighlight` helper now; `Note.highlightId` migration as its own planned change | **done — 2026-06-10.** Single guarded matcher in `src/lib/annotations.ts` (`notesByHighlight` + `orphanNotes`), unit-tested, consumed by both `HighlightsPanel` and `BookAnnotations`. `Note.highlightId` stays future schema work per the finding — no migration here |
| 5 | Test preamble unused imports | Delete 13 import lines; lint goes to zero | done — lint 0/0, tests 87/87 |
| 6 | Docs drift (epub2, `src/lib/reader/`, stray heading) | One docs pass, after the owner's in-flight README/CLAUDE.md edits land | **done — 2026-06-10.** README + CLAUDE.md stack lists now say `yauzl` + `fast-xml-parser` (in-house EPUB extraction) + pdfjs-dist; the `src/lib/reader/` phantom and the scaffold label are gone; the stray trailing heading is dropped; the four new API surfaces are listed. `grep epub2` over both docs → 0 |

As of 2026-06-10 the only open items are owner-gated: #2's Tailwind consolidation (needs
a browser to verify), and the decisions D1–D4 from the wiring plan (notes-export target,
collections cardinality, enrich-on-import schema, server-side folder filter) — plus the
`Note.highlightId` migration that #4 defers. Everything mechanical and everything buildable
without a schema migration is done.

---

## What I did — finishing pass (2026-06-10) — and why

This pass closed findings #1, #3, #4, #6 (and the wiring slices #1 was waiting on) in one
run. The reasoning behind each non-obvious choice, so the *why* survives the result:

**Folder filtering went server-side, not client-side.** The original plan sketch filtered
the library by folder in the browser, using each book's file path. That assumption was
stale: `/api/books` deliberately does not put `filePath` in its response — absolute disk
paths never reach the client, the same privacy posture that makes the folders route strip
scan-root prefixes before returning anything. So client-side path filtering had no data to
filter on, and adding the path back to the payload would have leaked exactly what the design
withholds. Instead `/api/books` gained an optional `folder` query parameter: the route
resolves each book's root-relative folder server-side and filters there, and only the
already-public fields go out. The rail re-queries `/api/books?folder=<path>` on select.

**Cite needed a client component; Export did not.** The detail page is a server component.
Copying citation text to the clipboard requires the browser clipboard API, which only exists
in client code — so the Cite control is a small client island that fetches the citation
route and copies (and offers the BibTeX as a `.bib` download). Export annotations is just a
link to the export route, which streams a Markdown file with an attachment header — no
clipboard, no client state, so it stayed a plain declarative link. The split is about which
side of the server/client boundary each action actually needs, not stylistic preference.

**`parseJson` got its own module, separate from the auth wrappers.** Slice C added two
helpers — body parsing and auth wrapping. They live in separate files
(`src/lib/parse-json.ts`, `src/lib/route-helpers.ts`) on purpose: the auth wrappers pull in
the auth stack, and during the migration the body-parsing tests started failing because
importing the wrappers dragged a transitive `next-auth` mock into suites that only wanted to
test JSON parsing. Splitting the pure, dependency-free parser into its own module let it be
unit-tested without any auth mocking, and kept the auth-heavy code out of tests that have no
business loading it.

**The guarded CFI matcher won over the terse one.** Two surfaces matched a note to a
highlight by comparing their CFI anchor strings for equality. One surface already guarded
against an empty/absent anchor (`anchor.cfi && ...`); the other compared raw. The unguarded
form has a latent bug: when both a note and a highlight have no CFI, `undefined === undefined`
is true, so a cfi-less note would spuriously pair with a cfi-less highlight. It is
unobservable today only because the reader flow that produces these anchors is EPUB-only and
every EPUB anchor carries a CFI — the moment a cfi-less anchor appears, the unguarded surface
mismatches. The shared helper adopts the guarded form (a falsy CFI never matches, even
against another falsy CFI) and a unit test pins that branch, so the latent bug cannot return.

**Auth now resolves before any DB read — a strictly tighter ordering.** Several handlers ran
the book-existence lookup *before* resolving the user, so an unauthenticated request to a
missing book could get a 404 before the 401. Harmless today (cookie middleware gates these
routes), but it is the kind of invariant that breaks silently if a route is ever exempted
the way the file-download route was. The `withUser`/`withAdmin` wrappers resolve auth first
by construction, so the migration flipped this everywhere for free. Five handlers actually
changed observable ordering — the notes, highlights, and progress POST routes, plus the two
new annotations and citation routes, all of which had done a `book.findUnique` ahead of auth.
The flip is strictly tighter: a caller who is not allowed in now learns nothing about whether
a resource exists.

---

## Verification gate

Gates discovered from `package.json`. Re-measured at the close of the finishing pass on
2026-06-10, after all six slices landed on `main`:

- `npx tsc --noEmit` — **pass** (0 errors).
- `npx vitest run` — **pass**, **17 files / 125 tests** (up from 10/87 at audit time: the
  new route-helper, annotations-helper, export-route, citation-route, and folder-filter
  suites), all against real ephemeral SQLite DBs.
- `npm run lint` — **pass**: **0 errors, 0 warnings** (finding #5's 13 warnings are gone).
- `npm run build` (production webpack build) — **pass**, compiled successfully, all routes
  emitted.

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

---

## Re-audit — 2026-06-29

Second pass, run after the metadata-enrichment and annotation-FK work landed
(commits `030ba42`→`7a0d856`). Focus: the new code (enrich-on-import scan hook,
`BookSuggestion` table + accept route, `Note.highlightId` FK) plus a fresh
security sweep of the auth and filesystem surfaces. The 2026-06-10 findings above
are preserved as the teaching record; this section records what changed and what
the second pass found.

### Snapshot — 2026-06-29

- **Stack unchanged** (Next.js 15 + Prisma/SQLite + NextAuth v5). ~128 TS/TSX
  files in `src/`. git: 145 commits, `main` in sync with origin, clean tree.
- **Slop profile is now genuinely low — the 2026-06-10 cleanup held.** The old
  headline finding (#1, 377-LOC unwired metadata layer) is **resolved**: every
  module now has product surface — `openlibrary`/`filename-signals` are wired
  through the enrich-on-import scan hook, `citation`/`folder-tree` through their
  routes. The duplicated `fetcher` (#2) is centralized in `src/lib/fetcher.ts`
  with **0 inline copies remaining**; route boilerplate (#3) is gone behind
  `withUser`/`withAdmin`; the CFI matcher (#4) is shared. Fresh greps: **0 bare
  `catch {}`, 0 TODO/FIXME/HACK markers** across `src/`.
- **Strengths, re-confirmed and extended.** The filesystem-serving surfaces are
  textbook-defensive: `books/[id]/file` authenticates before the DB lookup (no
  id-probing oracle), serves only scanner-recorded absolute paths (never request
  input), and parses Range headers defensively with threat-ID references; `/api/fs`
  is jailed with `path.relative` and returns one opaque error for
  out-of-jail/missing/unreadable alike (no existence oracle); `covers/[id]` routes
  through a guarded `resolveCoverPath`. The new accept route is transactional
  (all-or-nothing Book update + suggestion status flips) and collapses
  missing/cross-book suggestions to one 404. The enrich pipeline is best-effort by
  contract — every failure resolves to `[]`/swallow so a bad enrich can never break
  an import.
- **Gate health (re-measured, see Verification gate below): tsc 0 · lint 0 ·
  vitest 211/211 (26 files) · privacy audit clean.** All green.

### 7. Catalog-mutation authorization is inconsistent with the rest of the model  *(MODERATE→HIGH — privilege)*

- **Tell:** `POST /api/books/[id]/suggestions/[sid]` (accept a metadata
  suggestion) is gated `withUser` — any signed-in account. But accepting writes
  **shared Book catalog fields** (title, isbn, publisher, publishedAt) and attaches
  arbitrary subject **tags** library-wide. Every *other* shared-library mutation is
  `withAdmin`: `users`, `scan`, and `locations` (the scan roots). And `books/[id]`
  itself is **GET-only** — so the accept route is the *single* way to hand-edit a
  Book's catalog metadata, and it is the one shared-state mutator that any reader
  can reach. In a multi-user homelab (family/housemate reader accounts), any of
  them can rewrite catalog titles/authors/publishers and inject tags for everyone.
- **Why:** the route was modelled on its *siblings under `books/[id]/`* —
  highlights, notes, progress — which are correctly `withUser` because they are
  **per-user** data the user owns. The accept route looks like one of them
  (same path prefix, same `withUser` import) but it mutates **shared** state, not
  the caller's own. The category boundary (per-user vs shared-catalog) cuts across
  the URL tree, so pattern-matching on the neighbours picks the wrong gate.
- **Detect:** the gate map —
  `for f in $(grep -rl "export const \(POST\|PATCH\|DELETE\)" src/app/api --include=route.ts); do echo "$f: $(grep -oE 'with(User|Admin)' "$f" | sort -u)"; done`
  — shows `suggestions/[sid]` as the lone `withUser` route that writes a
  `prisma.book.update`, against `scan`/`locations`/`users` on `withAdmin`.
  Confirm `books/[id]` has no PATCH/DELETE:
  `grep -oE "export (async function|const) (GET|POST|PATCH|DELETE)" "src/app/api/books/[id]/route.ts"` → `GET` only.
- **Fix:** **an owner decision, then a one-line change.** If catalog curation is
  meant to be admin-only (consistent with `scan`/`locations`), swap
  `withUser<SuggestionContext>` → `withAdmin<SuggestionContext>` in
  `src/app/api/books/[id]/suggestions/[sid]/route.ts` and add a non-admin→403
  authz test alongside the existing suite. If non-admins *are* meant to curate,
  the current code is correct — but then record that intent in the route comment so
  the inconsistency with `locations`/`scan` reads as deliberate, not an oversight.

### 8. Enrich-on-import has no network timeout, and is awaited inside the scan loop  *(MODERATE — resource/liveness)*

- **Tell:** `enrichBook` (`src/lib/metadata/enrich.ts:36`) calls
  `searchOpenLibrary(query, { fetchImpl })` with **no `signal`** — and
  `searchOpenLibrary` only applies a timeout if one is passed in `opts.signal`, so
  none is enforced. The call is `await`ed inside `enrichNewBook`, which is itself
  `await`ed inside `scanFile` (`src/lib/scanner/index.ts:162,191`). Node's global
  `fetch` (undici) defaults to a 300-second headers/body timeout, so a slow or
  hung OpenLibrary response can block a thin book's import for up to ~5 minutes —
  serially, once per thin book — on a cold bulk scan. The failure is swallowed
  (best-effort), so it surfaces only as a scan that appears to hang.
- **Why:** the network was made injectable for testability (`fetchImpl`), and the
  unit tests pass a canned fetch that resolves instantly — so the missing timeout
  is invisible in-VM. The contract guarantees *correctness* under failure
  (resolve to `[]`), but says nothing about *latency* under a slow-but-not-failing
  server; the gap is liveness, not correctness, which unit tests don't probe. The
  grave run that built this already flagged the *serial-latency* shape; the missing
  timeout is the compounding half — without it, "slow" can become "stalled."
- **Detect:** `grep -n "searchOpenLibrary(" src/lib/metadata/enrich.ts` shows the
  call passes no `signal`; `grep -n "AbortSignal.timeout\|signal:" src/lib/metadata/*.ts`
  shows the only `signal` plumbing is the optional `opts.signal` the scan path
  never supplies.
- **Fix:** give `enrichBook` a bounded signal —
  `searchOpenLibrary(query, { fetchImpl, signal: AbortSignal.timeout(8000) })`
  (or a small `ENRICH_TIMEOUT_MS` const) — so a hung request aborts to `[]` like
  any other failure, preserving the best-effort contract. This is a safe,
  correctness-preserving hardening (a timeout only ever turns a hang into the
  already-handled empty result). The deeper *serial-per-book* latency on a large
  first scan (batch/concurrency/background the enrich) remains the owner-flagged
  design decision it already was — the timeout is the floor, not the whole fix.

---

## Triage / cleanup plan — re-audit (2026-06-29)

| # | Finding | Action | Status |
|---|---------|--------|--------|
| 7 | Catalog-mutation authz inconsistency (accept route is `withUser`, all other shared-state mutators are `withAdmin`) | Owner decides admin-only vs any-user; if admin-only, `withUser`→`withAdmin` + 403 test; else record intent in a comment | **DONE — 2026-06-29.** Owner confirmed it was unintentional (they assumed accepting a suggestion wrote *per-user* metadata; the schema has one shared `Book` row, so there is no per-user metadata to write). Best-practice check: self-hosted library servers gate catalog-metadata editing behind a privileged capability — Calibre-Web's "Allow Edit" permission, Komga's manager role, admin-only in Plex/Jellyfin — never the default for every reader. Gated **`withUser`→`withAdmin`** in `suggestions/[sid]/route.ts` (the comment now records the why + the future granular-role option); added a reader→403 case in `suggestions-route.test.ts` and to the AUTHZ-04 list in `authz-gates.test.ts` |
| 8 | Enrich has no network timeout; awaited in the scan loop → a hung OpenLibrary can stall a cold scan ~5 min/book | Pass `AbortSignal.timeout(...)` from `enrichBook`; keep the serial-vs-background latency call as the pre-existing owner decision | **DONE — 2026-06-29.** `enrichBook` now passes `AbortSignal.timeout(ENRICH_TIMEOUT_MS = 8000)` to `searchOpenLibrary`, so a hung request aborts to the already-handled `[]`. The broader serial-vs-background latency on a large first scan stays the pre-existing owner design decision (batch/concurrency/background) — the timeout is the floor, not that whole fix |

Both fixes landed 2026-06-29. The *per-user metadata* model the owner had assumed
(each reader editing their own copy of a book's catalog fields) is not how the
reference library servers work and is not in this schema — it would be a new
per-user override layer, a feature for another day, not the bug fix. The granular
"can edit metadata" role (Calibre-Web style) is the clean future path if specific
non-admins should curate without full admin; recorded in the route comment.

## Verification gate — re-audit (2026-06-29)

Re-measured in-VM at re-audit time (`prisma generate` run first to refresh the
generated client — a stale client reads red in-VM; the host predev hook
self-heals):

- `npx tsc --noEmit` — **pass** (0 errors).
- `npm run lint` (eslint) — **pass** (0 errors, 0 warnings).
- `npx vitest run` — **pass**, **26 files / 211 tests** (up from 17/125 at the
  2026-06-10 close: the route-helper, annotation-FK, enrich, suggestions-accept,
  duplicates, and genre-section suites), all against real ephemeral SQLite DBs.
- `./scripts/audit-privacy.sh` — **clean** (gitleaks 145 commits, no leaks;
  pattern scan clean).

Not verifiable from this environment, and therefore **not claimed** (unchanged
from 2026-06-10): live reader behavior, the scanner against a real folder under
load, OPDS against a real mobile client, and the Docker image / entrypoint
migration path.

**Both findings were applied the same day** (owner-approved): #7's `withAdmin`
gate and #8's enrich timeout. Re-measured after the fixes: **tsc 0 · lint 0 ·
vitest 214/214 (26 files)** (+3 from the new authz cases) — the new
reader→403 assertions pass and the four accept happy-paths were updated to an
admin session. The *behavioral* effect of #7 (a non-admin genuinely blocked in
the running app) and #8 (a real slow-OpenLibrary scan completing instead of
stalling) are gate-proven here but, like all runtime behavior, host-confirmable
by the owner against a live instance.
