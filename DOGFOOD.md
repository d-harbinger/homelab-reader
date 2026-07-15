# DOGFOOD — homelab-reader

Session-based dogfooding. Practice + why: `dev-tools/docs/dogfooding.md`. Pick one
charter, set a 60–90 min timer, run it against the **live Docker container** (the
library of record at `/app/books`), and log what happens. Capture bugs as
reproductions and keep going — fixes are a separate session.

## Charters — the ways a real user touches this

- [ ] **C1. Cold start + library scan.** Explore the container booting from cold
  with a real shelf of EPUB and PDF files dropped into `/app/books`, to find
  scan, indexing, duplicate-detection, and genre-row bugs. · 60m · needs: container
- [ ] **C2. Long-book reading.** Explore the EPUB reader on a 300+ page book —
  page turning, progress percentage, table-of-contents jumps, font and theme
  switches — to find rendering and progress-persistence bugs (does progress
  survive a reload?). · 60m · needs: container
- [ ] **C3. Annotations.** Explore the highlight / note flow end to end —
  create, edit, and the highlight-to-text binding — plus the new context-menu, to
  find lost or mis-bound annotations. · 60m · needs: container
- [ ] **C4. Enrich-on-import review.** Explore the metadata-suggestion review
  screen with a deliberately messy or missing-metadata book, to find
  suggestion / accept / reject bugs. · 45m · needs: container
- [ ] **C5. Mobile client over OPDS.** Explore a mobile reading app connecting to
  the live container over OPDS (the open catalog protocol e-readers use) —
  sign-in, browse, download — to find authentication and listing bugs. · 60m ·
  needs: container + a mobile reader app on a device
- [ ] **C6. Two accounts.** Explore two user accounts in parallel, each with its
  own progress and highlights, to find cross-user leakage. · 45m · needs: container
- [ ] **C7. Study workflow.** Explore the color-key study loop on a textbook:
  define the key on the book page (e.g. yellow = key terms, blue = organizations),
  highlight in those colors with the side panel open (it should push the text
  aside, not cover it), lean on Ctrl+Z to undo stray highlights, then export the
  flashcard deck and import it into Anki — to find layout, undo, key-persistence,
  and import-format bugs. · 60m · needs: container + Anki

## Bug log — capture-and-continue

```
### B1 — <one-line summary>
- build:     homelab-reader @ <commit> (container)
- did / expected / got:
- severity:  annoying | blocks-flow | data-loss
- status:    open
```

(none yet — the 2026-07-03 server-deploy captures were logged in the workspace
queue and fixed in the 2026-07-05 polish pass; see the session log.)

## Session log

| date | charter | dur | T/B/S | bugs found | notes |
|------|---------|-----|-------|-----------|-------|
| 2026-07-03 | server deploy (owner) | — | — | 4 + 2 tickets | rail not sticky · folder filters uneven · one EPUB import failed · detail-page font overflow · highlighter washed out · ink needs opacity |
| 2026-07-05 | fix pass (agent) | — | — | +2 found while fixing | all six above fixed (commits a377951..208f209); found+fixed: manual rescans never recorded failed imports; middleware 302'd the login form's own action POST. Captured, not fixed: byte-identical copies ping-pong one row between paths on rescans (copy-vs-move design question). |

| 2026-07-05 | C5 OPDS (agent) | — | — | 0 | machine-verified end-to-end on the headless AVD with Librera FD 9.3.75 (a real OPDS client): add catalog → server 401 challenge → HTTP-Basic (user + minted OPDS token) → catalog root ("All Books · 7 books", "Recently Added") → book list with covers/authors/formats → **downloaded Eloquent JavaScript.epub** (1.4 MB, `PK` magic bytes, opens in-reader). Server log: 8×401 then authenticated 200s on /api/opds, /api/opds/all, and /api/books/[id]/file. Real-device sign-off (stylus, physical reader) still owner. |
