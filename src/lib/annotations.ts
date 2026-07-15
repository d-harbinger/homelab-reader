// The single source of truth for the note↔highlight matching rule.
//
// RULE: a note belongs to a highlight when their anchor CFI strings are equal
// AND non-empty. The "non-empty" half is the GUARDED form: a falsy cfi
// (undefined / "") never matches, even against another falsy cfi — without the
// guard, `undefined === undefined` would spuriously pair a cfi-less note with a
// cfi-less highlight. BookAnnotations already guarded this; HighlightsPanel did
// not. The shared helper adopts the guarded form (correct in both, and a no-op
// in the EPUB-only reader where every anchor carries a cfi).
//
// Pure and shape-generic: callers pass whatever highlight/note objects they
// hold (their anchor types differ slightly across surfaces — `page?` on the
// detail page, not in the reader panel); all this rule needs is `id` and
// `anchor.cfi?`. No Prisma, no React, no fetch — fully unit-testable in-VM.
//
// NOTE: the Note.highlightId FK column does not exist in the schema YET (it is
// the owner-present Slice 2b migration). This rule is written ahead of it on
// purpose: `highlightId` is OPTIONAL on the note shape, so when it is absent
// everywhere — the case for all current data — the rule degrades EXACTLY to the
// legacy guarded-CFI behavior. Once the FK + data land, notes carrying a
// highlightId pair structurally instead of by a fragile CFI string, and legacy
// CFI-only notes keep pairing via the fallback. That optionality is what makes
// building the rule before the migration non-destructive.

import { cfiSortKey } from "@/lib/notes/markdown-export";

/** Minimal highlight shape this rule needs. */
interface HasCfiAnchor {
  anchor: { cfi?: string };
}

/** A highlight this rule can pair against: a stable id + a CFI anchor. */
interface HighlightLike extends HasCfiAnchor {
  id: string;
}

/**
 * A note that exposes a stable id (so callers can map back to it) and,
 * optionally, the id of the highlight it is structurally bound to. The
 * `highlightId` is the forward-looking FK (Slice 2b); until that column exists
 * it is simply absent on every note, and the rule falls back to CFI.
 */
interface NoteLike extends HasCfiAnchor {
  id: string;
  highlightId?: string | null;
}

/**
 * The single pairing rule. A note pairs with a highlight when:
 *   1. the note carries a `highlightId` → STRUCTURAL match on `highlight.id`.
 *      A present-but-different highlightId BLOCKS the CFI fallback: a note bound
 *      to another highlight must never pair here, even if the CFIs coincide.
 *   2. the note has no `highlightId` → the legacy guarded CFI equality.
 * With no highlightId anywhere this is identical to the pre-FK behavior.
 */
function pairs(note: NoteLike, highlight: HighlightLike): boolean {
  if (note.highlightId != null) return note.highlightId === highlight.id;
  return matchesCfi(note, highlight);
}

/**
 * Map each highlight's id to the note that pairs with it, if any. Highlights
 * with no matching note are absent from the map (callers use `?? null`).
 * Pairing prefers the structural `highlightId`, falling back to guarded CFI.
 */
export function notesByHighlight<H extends HighlightLike, N extends NoteLike>(
  highlights: H[],
  notes: N[],
): Map<string, N> {
  const map = new Map<string, N>();
  for (const h of highlights) {
    const match = notes.find((nt) => pairs(nt, h));
    if (match) map.set(h.id, match);
  }
  return map;
}

/**
 * The notes that pair with no highlight — the freeform/orphan notes (e.g.
 * book-level notes with `anchor.type === "book"` and no cfi, or a note whose
 * highlightId points at a highlight not in this set). Inverse of
 * notesByHighlight, using the same `pairs` rule so the two can never disagree.
 */
export function orphanNotes<H extends HighlightLike, N extends NoteLike>(
  highlights: H[],
  notes: N[],
): N[] {
  return notes.filter((nt) => !highlights.some((h) => pairs(nt, h)));
}

/** Guarded CFI equality: equal AND non-empty on both sides. */
function matchesCfi(note: HasCfiAnchor, highlight: HasCfiAnchor): boolean {
  return Boolean(note.anchor.cfi) && note.anchor.cfi === highlight.anchor.cfi;
}

/** Anchor fields the position sort reads (parsed anchors; all optional). */
interface PositionAnchor {
  cfi?: string;
  page?: number;
  progression?: number;
}

/**
 * Position-in-book sort key for a PARSED anchor — the client-side twin of
 * markdown-export's deriveLocator, which takes the stored JSON string. Same
 * idea: bucket prefix + fixed-width payload, so string comparison gives
 * document order. EPUB CFIs sort first ("0:"), PDF pages next ("1:"), a
 * synced text-quote highlight that only knows its 0..1 reading position sorts
 * by that ("2:" — transient, it upgrades to a CFI on view), and anchors with
 * no usable locator sink to the end ("9:") instead of throwing. Within one
 * book only one of the first two buckets occurs, so the prefixes never
 * actually interleave formats.
 */
export function anchorSortKey(anchor: PositionAnchor): string {
  if (anchor.cfi) return `0:${cfiSortKey(anchor.cfi)}`;
  if (typeof anchor.page === "number") {
    return `1:${String(anchor.page).padStart(8, "0")}`;
  }
  if (typeof anchor.progression === "number") {
    return `2:${String(Math.round(anchor.progression * 1e6)).padStart(8, "0")}`;
  }
  return "9:";
}

/**
 * Order highlights by position in the book (id as the deterministic
 * tiebreak). Returns a new array; the input is untouched.
 */
export function byBookPosition<H extends HighlightLike & { anchor: PositionAnchor }>(
  highlights: H[],
): H[] {
  return [...highlights].sort((a, b) => {
    const ka = anchorSortKey(a.anchor);
    const kb = anchorSortKey(b.anchor);
    if (ka !== kb) return ka < kb ? -1 : 1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}
