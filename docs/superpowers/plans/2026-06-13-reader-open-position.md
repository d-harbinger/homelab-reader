# Reader Open Position — Plan (CLARIFY-FIRST)

> **For agentic workers:** Do NOT build before the owner confirms the repro (below). The obvious fixes are already shipped; building more without the real repro risks fixing the wrong thing.

**STATUS:** PENDING (owner-clarify) · valid-as-of 2026-06-13
**Value:** M — owner dogfood note 2026-06-11: *"opening a book lands on the spine start rather than something useful — tedious."* Real friction, but the surface area is small and **partly already addressed**, so this is a precision fix, not a feature.

---

## What the code ALREADY does (verified 2026-06-13)

- **Resume-at-last works for both formats.** `src/app/books/[id]/read/page.tsx` loads the user's `Progress` row and passes `initialCfi` (EPUB) / `initialPage` (PDF) into the reader. The EPUB reader honors the saved CFI; the PDF reader opens at the saved page.
- **First-open already skips the cover (EPUB).** `EpubReader` (commit `7ae0f53`, **2026-05-31**) deliberately opens the *first real content spine item* (`index > 0 && linear !== "no"`), not the cover.

**The critical fact:** that cover-skip shipped on **2026-05-31**, *ten days before* the owner's 2026-06-11 complaint. So the gripe was made **with the skip already in place** — the simple fix is already done and did not satisfy the owner. Building "skip the cover" again would be wasted work.

---

## The real open question (owner must disambiguate)

The complaint is consistent with three different root causes, each a different fix:

- **R1 · The heuristic lands in FRONT MATTER, not chapter 1.** "First content section" (`spine.items[1]`) is often the title page / copyright / TOC — `linear="yes"` content that precedes the body. *Fix:* use the EPUB **navigation landmarks** (`book.navigation` / `landmarks`, the `bodymatter`/`text` landmark) to jump to the body start, falling back to the current heuristic.
- **R2 · It was a PDF.** PDFs have NO cover-skip — `initialPage` defaults to `1`, which for a scanned book is the cover image. *Fix:* a first-open PDF heuristic is far weaker (no landmarks); likely "page 1 is correct, accept it" or a per-book stored "start page."
- **R3 · Resume didn't fire.** Progress saves on an 800ms debounce after a relocate; a quick open-and-close may never persist. The owner would then *expect* resume and get first-content. *Fix:* none needed in code — it's working as designed; clarify expectation.

**Decision to bring (field 4):**
- **D-D1 · Which book + format produced the gripe, and had it been read past the first page before?** No default — this is the disambiguator. Bring the exact title.
- **D-D2 · Intended first-open target (no saved progress):** Default **R1 fix — jump to the `bodymatter` landmark (body start), fall back to first-content, fall back to cover.** This is the most likely intent ("something useful" = the actual book) and is reversible.

---

## Load-bearing assumptions (field 8 — verify before any build)

1. `read/page.tsx` sources `initialCfi`/`initialPage` from `Progress` — `sed -n '20,60p' src/app/books/[id]/read/page.tsx`.
2. `EpubReader` first-open heuristic is the `spine.items` block — `grep -n "firstContent" src/components/EpubReader.tsx`.
3. epub.js exposes `book.navigation` / landmarks — confirm the loaded epub.js version surfaces `navigation.landmarks` before relying on it (`grep -n "navigation" src/components/EpubReader.tsx` likely returns nothing today → it's unused; verify the lib API in node before building).

---

## Slice (owner-gated, HOST-VERIFY — only after D-D1/D-D2)

- [ ] If **R1**: in `EpubReader`, when `!initialCfi`, resolve the `bodymatter` landmark href via `book.loaded.navigation` (or `book.navigation`), set it as `target`; keep the current spine heuristic as fallback. Reader behavior → **host-verify** (browser; no in-env gate for epub.js rendering).
- [ ] If **R2/R3**: likely no code change — record the resolution.
- [ ] Commit only the path taken: `feat(reader): open EPUBs at the bodymatter landmark, not front matter`.

---

## Self-review

- **Honest scoping:** the cheap fix is already shipped and pre-dates the complaint; this plan refuses to re-do it and instead isolates the three real possibilities.
- **Cheap to resolve:** one owner sentence (which book/format) collapses this to a one-function change or a no-op.
- **No schema, no unattended build** — reader rendering is host-verify only.
