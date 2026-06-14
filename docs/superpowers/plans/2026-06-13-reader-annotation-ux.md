# Reader Annotation-UX Depth — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Mixed lanes — one slice is agent-env/AUTO, the rest are owner-present (schema) or host-verify (reader interaction). Respect the per-slice markers.

**STATUS:** Slice 1 DONE (`2260739` palette→7 + single-sourced validation across BOTH highlights routes; orchestrator-gate-verified: 9 tests, full suite 168/168, tsc 0, build 0) · Slice 2a READY (agent-env, held for the schema window — no-op until 2b's FK exists) · Slices 2b (owner-present) + 3 (host-verify) PENDING · valid-as-of 2026-06-13
**Value:** H — owner dogfood verdict 2026-06-11: annotations *"work, but a power user would be underwhelmed"* (the "Zotero bar"). Three concrete gaps: (1) no right-click context menu in the reader, (2) no add-note-on-highlight flow, (3) the color set is small. This is the depth pass that makes the reader feel like a real annotation tool.

**Goal:** Make highlighting + note-taking feel first-class: a richer color palette, a context menu on selection/highlight, and a note explicitly bound to its highlight (not paired by a fragile CFI string).

**Architecture:** Build on the shipped annotation core — `src/lib/highlight-colors.ts` (palette), `src/lib/annotations.ts` (the note↔highlight matching rule), the `/api/highlights` + `/api/notes` routes, and `EpubReader`/`HighlightsPanel`/`BookAnnotations`. The structural fix is **TEACHING #4**: replace CFI-equality pairing with a real `Note.highlightId` FK (owner-present migration). Everything else layers on top.

**Tech stack:** Next.js 15, Prisma/SQLite, epub.js, Vitest. Reader interactions are browser-only → host-verify.

---

## Load-bearing assumptions (field 8 — verify BEFORE building)

1. **Palette is `src/lib/highlight-colors.ts`** — `HighlightColor` union (`yellow|green|blue|pink`), `HIGHLIGHT_COLORS` record, `HIGHLIGHT_ORDER`. `Highlight.color` is a free `String @default("yellow")` in the schema (NO enum → adding colors needs no migration).
   `cat src/lib/highlight-colors.ts && grep -n "color" prisma/schema.prisma`
2. **The `/api/highlights` route validates `color` against the palette** (the comment in highlight-colors.ts says "names map 1:1 to the validated values"). Find the validation list and update it WITH the palette, single-sourced.
   `grep -rn "yellow\|green\|blue\|pink\|HIGHLIGHT_COLORS\|color" src/app/api/highlights/`
3. **Note↔highlight pairing is `src/lib/annotations.ts`** (`notesByHighlight`/`orphanNotes`/`matchesCfi`), and it explicitly documents that `Note.highlightId` does not yet exist and is "a planned schema change."
   `cat src/lib/annotations.ts`
4. **No `Note.highlightId` column today.** `grep -n "highlightId" prisma/schema.prisma` → expect NO hit (confirms the migration is unstarted).
5. **Reader surfaces:** `EpubReader.tsx` paints highlights + has the color popover; `HighlightsPanel.tsx` + `BookAnnotations.tsx` list them. `grep -n "popover\|color\|contextmenu\|onContextMenu" src/components/EpubReader.tsx`.

Any miss → STOP and report.

---

## Decisions to bring (field 4 — defaults)

- **D-E1 · Expanded palette.** Default: add **orange, purple, red** to the existing yellow/green/blue/pink (→ 7), keeping the soft 40%-alpha convention and the educational-calm aesthetic (do NOT introduce a garish set — see `feedback_aesthetic_work_ownership`; the owner owns the final swatches). `HIGHLIGHT_ORDER` defines popover order.
- **D-E2 · Note↔highlight binding.** Default: **add `Note.highlightId String?` FK** (TEACHING #4). New notes created from a highlight set it; the matching helper prefers `highlightId`, falling back to CFI equality for legacy notes (so existing data keeps pairing). Migration is additive + nullable → one `migrate dev`, owner-present.
- **D-E3 · Context-menu actions.** Default scope: **highlight (with color submenu), add note, copy text, remove** — on text selection and on an existing highlight. Right-click (`onContextMenu`) with a left-click/long-press fallback for trackpads/touch. PDF parity is a stretch goal, EPUB first.
- **D-E4 · Add-note-on-highlight UX.** Default: selecting "Add note" on a highlight opens the existing note composer pre-anchored to that highlight's CFI **and** carrying its `highlightId`, so the note pairs structurally. No new note model — reuse `/api/notes` with the new optional `highlightId`.

---

## Automation guardrails (per-slice)

- ✅ **Auto-completable (agent-env)** — gate = vitest + tsc + build green, then commit:
  - **Slice 1** (palette expansion: data + route validation + tests — the *rendering* of new swatches is host-verify, but the data/validation/contract is fully agent-env)
  - **Slice 2a** (the `annotations.ts` matching-rule upgrade as a PURE function: prefer `highlightId`, fall back to CFI — unit-testable with no DB)
- 🛑 **STOP-for-human:**
  - **Slice 2b** (owner-present): the `Note.highlightId` migration + route wiring (`prisma migrate dev`)
  - **Slice 3** (host-verify): the reader context menu + add-note-on-highlight UI (browser)
- 🚫 Never run `prisma migrate dev` unattended. Guard denial = hard STOP.

---

## Slice 1 — expanded palette (agent-env, AUTO)

**Files:** `src/lib/highlight-colors.ts`, the `/api/highlights` validation site (from assumption 2), `tests/` (a new `tests/highlight-colors.test.ts` + extend the highlights-route test if one exists).

- [ ] **Step 1 — failing test:** assert the new colors exist in `HIGHLIGHT_COLORS`/`HIGHLIGHT_ORDER` with the alpha convention (`rgba(...,0.4)`); assert the `/api/highlights` route ACCEPTS a new color and REJECTS an unknown one (`400`), proving validation single-sources from the palette (not a stale inline list).
- [ ] **Step 2 — implement:** add the colors to the palette; point the route validation at `HIGHLIGHT_COLORS` keys (if it currently inlines the list, replace the inline list with `Object.keys(HIGHLIGHT_COLORS)` so they can never drift). Update the `HighlightColor` union.
- [ ] **Step 3 — gate:** `npx vitest run tests/highlight-colors.test.ts <highlights-route-test> && npx tsc --noEmit && npm run build`.
- [ ] **Step 4 — commit:** `feat(reader): expand highlight palette to 7 colors, single-sourced validation`.
- [ ] **Host-verify (owner, deferred):** the popover shows the new swatches and they paint correctly.

---

## Slice 2a — matching rule prefers `highlightId` (agent-env, AUTO)

**Files:** `src/lib/annotations.ts`, `tests/annotation-matching.test.ts`.

- [ ] Upgrade `matchesCfi`-based pairing to a `pairs(note, highlight)` rule: **true if `note.highlightId === highlight.id`** (when present), ELSE the existing guarded CFI equality. `notesByHighlight`/`orphanNotes` use the new rule. The shape gains an optional `highlightId?: string | null` on `NoteLike`.
- [ ] Tests: highlightId match wins; legacy CFI-only note still pairs; a note with a *wrong* highlightId does NOT pair even if CFI coincides; cfi-less + highlightId-less never pairs (the existing guard).
- [ ] Gate + commit: `refactor(annotations): pair notes by highlightId, fall back to CFI for legacy`.

> Building 2a before 2b is safe: the field is optional, so the rule degrades to today's behavior until the column + data exist. This de-risks the owner's migration session.

---

## Slice 2b — `Note.highlightId` migration + route wiring (OWNER-PRESENT)

- [ ] Schema: `Note { … highlightId String?; highlight Highlight? @relation(fields: [highlightId], references: [id], onDelete: SetNull); @@index([highlightId]) }` + the inverse on `Highlight`. **`onDelete: SetNull`** so deleting a highlight orphans (not deletes) its note — the note text is the user's, the highlight is just its anchor.
- [ ] `npx prisma migrate dev --name note_highlight_fk` (owner runs; batch with the relative-path window per `2026-06-13-relative-path-migration.md`).
- [ ] `/api/notes` POST accepts optional `highlightId`, validates the highlight exists + belongs to the user, stores it. Update the notes-route test.
- [ ] Gate (post-migration) + commit: `feat(notes): bind a note to its highlight via FK`.

---

## Slice 3 — reader context menu + add-note-on-highlight (HOST-VERIFY)

**Files:** `EpubReader.tsx` (+ a small `SelectionMenu` component), `HighlightsPanel.tsx`/`BookAnnotations.tsx` for the composer entry point.

- [ ] On text selection and on an existing highlight, show a context menu (D-E3 actions) — `onContextMenu` + fallback. Highlight → color submenu (the Slice-1 palette). "Add note" → opens the composer pre-anchored to the CFI and carrying `highlightId` (D-E4), persisting via the Slice-2b route.
- [ ] **Host-verify (owner):** right-click a selection → highlight in a chosen color; right-click a highlight → add a note; the note shows paired in the panel; reload preserves the pairing (structural, not CFI-luck).
- [ ] Commit: `feat(reader): selection/highlight context menu + add-note-on-highlight`.

---

## Self-review

- **Reuse integrity:** `highlight-colors.ts`, `annotations.ts` (`notesByHighlight`/`orphanNotes`/`matchesCfi`), `/api/highlights`, `/api/notes`, `Highlight.color` as a free string — all real (verified 2026-06-13).
- **TEACHING #4 closed structurally:** the FK replaces the fragile CFI join; legacy data still pairs via the fallback, so the migration is non-destructive.
- **Lane honesty:** Slices 1 + 2a are genuinely agent-env (pure data/logic + contract tests); the migration and the browser interactions are correctly gated. No "verify visually at the end" on the agent-env slices.
- **Aesthetic ownership:** the new swatches are a default the owner finalizes — the plan ships the mechanism, not a forced palette.
