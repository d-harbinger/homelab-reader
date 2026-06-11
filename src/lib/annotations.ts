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
// NOTE: there is no Note.highlightId column; the CFI string is the join key.
// Adding that FK is a planned schema change, not this helper's concern.

/** Minimal highlight shape this rule needs. */
interface HasCfiAnchor {
  anchor: { cfi?: string };
}

/** A note that also exposes a stable id (so callers can map back to it). */
interface NoteLike extends HasCfiAnchor {
  id: string;
}

/**
 * Map each highlight's id to the note whose cfi matches it, if any. Highlights
 * with no matching note are absent from the map (callers use `?? null`).
 * Matching is the guarded CFI-equality rule; a cfi-less anchor never matches.
 */
export function notesByHighlight<H extends HasCfiAnchor & { id: string }, N extends NoteLike>(
  highlights: H[],
  notes: N[],
): Map<string, N> {
  const map = new Map<string, N>();
  for (const h of highlights) {
    const match = notes.find((nt) => matchesCfi(nt, h));
    if (match) map.set(h.id, match);
  }
  return map;
}

/**
 * The notes that match no highlight — the freeform/orphan notes (e.g. book-level
 * notes with `anchor.type === "book"` and no cfi). Inverse of notesByHighlight,
 * using the same guarded rule so the two can never disagree.
 */
export function orphanNotes<H extends HasCfiAnchor, N extends NoteLike>(
  highlights: H[],
  notes: N[],
): N[] {
  return notes.filter((nt) => !highlights.some((h) => matchesCfi(nt, h)));
}

/** Guarded CFI equality: equal AND non-empty on both sides. */
function matchesCfi(note: HasCfiAnchor, highlight: HasCfiAnchor): boolean {
  return Boolean(note.anchor.cfi) && note.anchor.cfi === highlight.anchor.cfi;
}
