// TEACHING #4 — the note↔highlight CFI-matching rule lives in ONE place.
//
// "A note belongs to a highlight when their anchor CFI strings are equal" was
// implemented independently in HighlightsPanel.tsx (lookup, UNGUARDED) and
// BookAnnotations.tsx (lookup AND inverse orphan predicate, GUARDED with
// `n.anchor.cfi &&`). This pins the single shared rule both surfaces now share.
//
// Pure: plain data in, matches/orphans out — no DB, no React, no fetch.
//
// Branches exercised:
//   - notesByHighlight: a note matches its highlight by equal cfi
//   - notesByHighlight: a highlight with no matching note → null
//   - GUARDED form: a note whose anchor cfi is null/absent NEVER matches, even
//     against a highlight whose cfi is also null/absent (the bug the unguarded
//     `undefined === undefined` form would hit — HighlightsPanel used to)
//   - orphanNotes: notes matching no highlight are returned; matched notes are not
//   - orphanNotes: a cfi-less note is always an orphan (guarded form)

import { describe, it, expect } from "vitest";
import { notesByHighlight, orphanNotes } from "@/lib/annotations";

type H = { id: string; anchor: { cfi?: string } };
type N = { id: string; anchor: { cfi?: string } };

const h = (id: string, cfi?: string): H => ({ id, anchor: { cfi } });
const n = (id: string, cfi?: string): N => ({ id, anchor: { cfi } });

describe("notesByHighlight", () => {
  it("matches a note to its highlight by equal cfi", () => {
    const highlights = [h("h1", "/6/2[chap]!/4/2")];
    const notes = [n("n1", "/6/2[chap]!/4/2")];
    const map = notesByHighlight(highlights, notes);
    expect(map.get("h1")?.id).toBe("n1");
  });

  it("returns no note for a highlight that has no matching note", () => {
    const highlights = [h("h1", "/6/2!/4/2")];
    const notes = [n("n1", "/6/4!/8/6")];
    const map = notesByHighlight(highlights, notes);
    expect(map.get("h1") ?? null).toBeNull();
  });

  it("GUARDED: a cfi-less note never matches a cfi-less highlight", () => {
    // Unguarded `n.anchor.cfi === h.anchor.cfi` would be `undefined === undefined`
    // → true, a spurious match. The shared helper adopts the guarded form.
    const highlights = [h("h1", undefined)];
    const notes = [n("n1", undefined)];
    const map = notesByHighlight(highlights, notes);
    expect(map.get("h1") ?? null).toBeNull();
  });
});

describe("orphanNotes", () => {
  it("returns notes matching no highlight and excludes matched ones", () => {
    const highlights = [h("h1", "/6/2!/4/2")];
    const notes = [n("matched", "/6/2!/4/2"), n("free", "/6/9!/2/2")];
    const orphans = orphanNotes(highlights, notes);
    expect(orphans.map((o) => o.id)).toEqual(["free"]);
  });

  it("GUARDED: a cfi-less note is always an orphan", () => {
    const highlights = [h("h1", undefined)];
    const notes = [n("book-note", undefined)];
    const orphans = orphanNotes(highlights, notes);
    expect(orphans.map((o) => o.id)).toEqual(["book-note"]);
  });
});

// Slice 2a — the pairing rule prefers a structural `highlightId` when present,
// and DEGRADES to the existing guarded CFI equality when it is absent. Building
// this before the FK migration (Slice 2b) is safe precisely because the field is
// optional: with no highlightId anywhere, every branch below collapses to the
// pre-existing CFI behavior pinned by the tests above.
type NId = { id: string; anchor: { cfi?: string }; highlightId?: string | null };
const nh = (id: string, cfi: string | undefined, highlightId?: string | null): NId => ({
  id,
  anchor: { cfi },
  highlightId,
});

describe("highlightId pairing (Slice 2a)", () => {
  it("highlightId match wins: a note pairs to the highlight whose id it carries", () => {
    const highlights = [h("h1", "/6/2!/4/2"), h("h2", "/6/4!/8/6")];
    const notes = [nh("n1", "/6/4!/8/6", "h1")]; // cfi points at h2, but FK says h1
    const map = notesByHighlight(highlights, notes);
    expect(map.get("h1")?.id).toBe("n1");
    // and it must NOT also leak onto h2 via the coincident cfi
    expect(map.get("h2") ?? null).toBeNull();
  });

  it("legacy CFI-only note (no highlightId) still pairs via matchesCfi", () => {
    const highlights = [h("h1", "/6/2!/4/2")];
    const notes = [nh("legacy", "/6/2!/4/2", undefined)];
    const map = notesByHighlight(highlights, notes);
    expect(map.get("h1")?.id).toBe("legacy");
  });

  it("a WRONG highlightId does NOT pair even when the cfi coincides with the highlight", () => {
    // The note's cfi equals h1's cfi (would pair under the legacy rule), but its
    // highlightId points elsewhere — the structural key wins and BLOCKS the match.
    const highlights = [h("h1", "/6/2!/4/2")];
    const notes = [nh("n1", "/6/2!/4/2", "h-other")];
    const map = notesByHighlight(highlights, notes);
    expect(map.get("h1") ?? null).toBeNull();
    // …and it is therefore an orphan.
    const orphans = orphanNotes(highlights, notes);
    expect(orphans.map((o) => o.id)).toEqual(["n1"]);
  });

  it("a note with neither cfi nor highlightId never pairs (the existing guard holds)", () => {
    const highlights = [h("h1", undefined)];
    const notes = [nh("n1", undefined, undefined)];
    const map = notesByHighlight(highlights, notes);
    expect(map.get("h1") ?? null).toBeNull();
    const orphans = orphanNotes(highlights, notes);
    expect(orphans.map((o) => o.id)).toEqual(["n1"]);
  });
});
