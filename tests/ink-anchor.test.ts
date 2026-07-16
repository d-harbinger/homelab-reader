// The ink anchor union + the pure fragment geometry behind block-anchored ink.
//
// A PDF stroke anchors to a page number; an EPUB stroke anchors to the CFI of
// the block it was drawn on, so it rides reflow instead of rotting at fixed
// pixels. Both helpers here are DOM-free — parseInkAnchor guards the wire, and
// pickFragment decides which of a split block's fragments owns a stroke — so
// they run in the node environment with plain rect-likes, not DOMRects.
//
// Branches exercised:
//   parseInkAnchor — valid page · valid block · over-long CFI · missing cfi ·
//                    non-integer section · negative section · non-object ·
//                    null · unknown kind · page below 1 / non-integer ·
//                    normalization drops unknown keys
//   pickFragment   — empty rects -> null · 1 rect -> 0 · 2 rects picked by
//                    origin · origin outside every rect -> nearest, never -1 ·
//                    degenerate zero-area union -> 0
//   unionRect      — empty -> null · 1 rect -> itself · 2 rects -> the box
//                    spanning both, gap included
//   placeInkStroke — empty rects -> null · zero-area block -> null · untorn
//                    block -> the block's box, not torn, nib scaled by width ·
//                    surface origin subtracted · torn block -> union box + clip
//                    to the fragment holding the origin (either side) · nib
//                    scaled by the FRAGMENT so a torn block isn't double-thick
import { describe, it, expect } from "vitest";
import {
  INK_CFI_MAX_LENGTH,
  INK_VB,
  parseInkAnchor,
  pickFragment,
  placeInkStroke,
  unionRect,
} from "@/lib/ink";

describe("parseInkAnchor", () => {
  it("accepts a page anchor (the PDF shape)", () => {
    expect(parseInkAnchor({ kind: "page", page: 3 })).toEqual({
      kind: "page",
      page: 3,
    });
  });

  it("accepts a block anchor (the EPUB shape)", () => {
    expect(
      parseInkAnchor({ kind: "block", cfi: "epubcfi(/6/4!/4/2/2)", section: 0 }),
    ).toEqual({ kind: "block", cfi: "epubcfi(/6/4!/4/2/2)", section: 0 });
  });

  it("rejects a CFI over the length bound, accepts one at it", () => {
    const atBound = "x".repeat(INK_CFI_MAX_LENGTH);
    expect(parseInkAnchor({ kind: "block", cfi: atBound, section: 1 })).toEqual({
      kind: "block",
      cfi: atBound,
      section: 1,
    });
    expect(
      parseInkAnchor({ kind: "block", cfi: "x".repeat(INK_CFI_MAX_LENGTH + 1), section: 1 }),
    ).toBeNull();
  });

  it("rejects a block anchor with a missing or empty cfi", () => {
    expect(parseInkAnchor({ kind: "block", section: 0 })).toBeNull();
    expect(parseInkAnchor({ kind: "block", cfi: "", section: 0 })).toBeNull();
    expect(parseInkAnchor({ kind: "block", cfi: 42, section: 0 })).toBeNull();
  });

  it("rejects a non-integer or negative section", () => {
    expect(parseInkAnchor({ kind: "block", cfi: "/6/4", section: 1.5 })).toBeNull();
    expect(parseInkAnchor({ kind: "block", cfi: "/6/4", section: -1 })).toBeNull();
    expect(parseInkAnchor({ kind: "block", cfi: "/6/4", section: "0" })).toBeNull();
    expect(parseInkAnchor({ kind: "block", cfi: "/6/4" })).toBeNull();
    // Section 0 is the first spine item — a legitimate index, not falsy-rejected.
    expect(parseInkAnchor({ kind: "block", cfi: "/6/4", section: 0 })).not.toBeNull();
  });

  it("rejects a non-integer or below-1 page", () => {
    expect(parseInkAnchor({ kind: "page", page: 0 })).toBeNull();
    expect(parseInkAnchor({ kind: "page", page: -2 })).toBeNull();
    expect(parseInkAnchor({ kind: "page", page: 2.5 })).toBeNull();
    expect(parseInkAnchor({ kind: "page", page: "3" })).toBeNull();
    expect(parseInkAnchor({ kind: "page" })).toBeNull();
  });

  it("rejects a non-object, null, and an unknown kind", () => {
    expect(parseInkAnchor(null)).toBeNull();
    expect(parseInkAnchor(undefined)).toBeNull();
    expect(parseInkAnchor("page")).toBeNull();
    expect(parseInkAnchor(7)).toBeNull();
    expect(parseInkAnchor({})).toBeNull();
    expect(parseInkAnchor({ kind: "pixel", x: 1 })).toBeNull();
  });

  it("normalizes — unknown keys never survive into the stored anchor", () => {
    expect(
      parseInkAnchor({ kind: "block", cfi: "/6/4", section: 2, evil: "x".repeat(9000) }),
    ).toEqual({ kind: "block", cfi: "/6/4", section: 2 });
  });
});

describe("pickFragment", () => {
  // A block split across a column break yields one rect per fragment. These
  // are two columns of the same block: left 0..100, right 200..300.
  const twoColumns = [
    { x: 0, y: 0, width: 100, height: 200 },
    { x: 200, y: 0, width: 100, height: 200 },
  ];

  it("returns null for no rects — nothing to paint into", () => {
    expect(pickFragment([], 0.5, 0.5)).toBeNull();
  });

  it("returns 0 for a single rect — one fragment always owns the stroke", () => {
    expect(pickFragment([{ x: 10, y: 10, width: 50, height: 50 }], 0.5, 0.5)).toBe(0);
    // Even an origin fraction outside 0..1 still lands on the only fragment.
    expect(pickFragment([{ x: 10, y: 10, width: 50, height: 50 }], 9, -9)).toBe(0);
  });

  it("picks the fragment containing the origin fraction", () => {
    expect(pickFragment(twoColumns, 0.1, 0.5)).toBe(0);
    expect(pickFragment(twoColumns, 0.9, 0.5)).toBe(1);
  });

  it("falls back to the nearest fragment when the origin lands in the gap", () => {
    // 0.45 and 0.6 sit in the inter-column gap (0.334..0.666), inside no
    // fragment. The stroke must still paint on the near side, never -1.
    expect(pickFragment(twoColumns, 0.45, 0.5)).toBe(0);
    expect(pickFragment(twoColumns, 0.6, 0.5)).toBe(1);
  });

  it("never returns -1 for any origin, however far out of range", () => {
    for (const [ox, oy] of [
      [-5, -5],
      [5, 5],
      [0.5, 99],
      [Number.NaN, 0.5],
    ]) {
      const i = pickFragment(twoColumns, ox, oy);
      expect(i).not.toBeNull();
      expect(i).toBeGreaterThanOrEqual(0);
      expect(i).toBeLessThan(twoColumns.length);
    }
  });

  it("survives a degenerate zero-area union without dividing by zero", () => {
    const collapsed = [
      { x: 5, y: 5, width: 0, height: 0 },
      { x: 5, y: 5, width: 0, height: 0 },
    ];
    expect(pickFragment(collapsed, 0.5, 0.5)).toBe(0);
  });
});

describe("unionRect", () => {
  it("has no box for no fragments", () => {
    expect(unionRect([])).toBeNull();
  });

  it("returns a lone fragment unchanged", () => {
    const only = { x: 10, y: 20, width: 300, height: 80 };
    expect(unionRect([only])).toEqual(only);
  });

  it("spans both fragments of a split block, column gap included", () => {
    expect(
      unionRect([
        { x: 0, y: 400, width: 400, height: 100 },
        { x: 500, y: 0, width: 400, height: 60 },
      ]),
    ).toEqual({ x: 0, y: 0, width: 900, height: 500 });
  });
});

describe("placeInkStroke", () => {
  // One paragraph, whole and on screen — the overwhelmingly common case.
  const whole = [{ x: 100, y: 200, width: 500, height: 120 }];
  // The same paragraph torn across a two-column spread: the tail of column one,
  // continuing at the head of column two. The union spans the gap between them.
  const torn = [
    { x: 0, y: 400, width: 400, height: 100 }, // fragment 0 — bottom of col 1
    { x: 500, y: 0, width: 400, height: 60 }, // fragment 1 — top of col 2
  ];

  it("has nowhere to paint a block with no fragments", () => {
    expect(placeInkStroke([], 0.5, 0.5, 0, 0)).toBeNull();
  });

  it("has nowhere to paint a block that measures zero", () => {
    const hidden = [{ x: 10, y: 10, width: 0, height: 0 }];
    expect(placeInkStroke(hidden, 0.5, 0.5, 0, 0)).toBeNull();
  });

  it("maps an untorn block's fractions onto its own box and leaves it unclipped", () => {
    const p = placeInkStroke(whole, 0.5, 0.5, 0, 0);
    expect(p).not.toBeNull();
    expect(p!.torn).toBe(false);
    expect({ x: p!.x, y: p!.y, width: p!.width, height: p!.height }).toEqual({
      x: 100,
      y: 200,
      width: 500,
      height: 120,
    });
    // The nib scales off the block's width, never its aspect.
    expect(p!.strokeScale).toBe(500 / INK_VB);
  });

  it("subtracts the overlay's own origin so the caller gets overlay-local px", () => {
    const p = placeInkStroke(whole, 0.5, 0.5, 40, 60);
    expect({ x: p!.x, y: p!.y }).toEqual({ x: 60, y: 140 });
    // The surface origin moves the box; it never resizes it.
    expect({ width: p!.width, height: p!.height }).toEqual({
      width: 500,
      height: 120,
    });
  });

  it("maps a torn block onto the union — the space capture measured in — and clips to the fragment holding the origin", () => {
    // Origin low-left: inside fragment 0's share of the union box.
    const p = placeInkStroke(torn, 0.1, 0.9, 0, 0);
    expect(p!.torn).toBe(true);
    expect({ x: p!.x, y: p!.y, width: p!.width, height: p!.height }).toEqual({
      x: 0,
      y: 0,
      width: 900,
      height: 500,
    });
    expect({
      clipX: p!.clipX,
      clipY: p!.clipY,
      clipWidth: p!.clipWidth,
      clipHeight: p!.clipHeight,
    }).toEqual({ clipX: 0, clipY: 400, clipWidth: 400, clipHeight: 100 });
  });

  it("clips a torn block to the other fragment when the origin lives there", () => {
    // Origin high-right: inside fragment 1's share of the union box.
    const p = placeInkStroke(torn, 0.9, 0.05, 0, 0);
    expect({ clipX: p!.clipX, clipY: p!.clipY }).toEqual({ clipX: 500, clipY: 0 });
  });

  it("rides a reflow — the whole point of anchoring to a block instead of pixels", () => {
    // The font stepped up: the paragraph keeps its column width, grows taller,
    // and is pushed down the page. A pixel-anchored stroke would rot here.
    const before = placeInkStroke(whole, 0.5, 0.5, 0, 0);
    const after = placeInkStroke(
      [{ x: 100, y: 260, width: 500, height: 180 }],
      0.5,
      0.5,
      0,
      0,
    );
    // Same fractions, new box: the mark lands wherever the block landed.
    expect({ x: after!.x, y: after!.y, height: after!.height }).toEqual({
      x: 100,
      y: 260,
      height: 180,
    });
    expect(after!.y).toBeGreaterThan(before!.y);
    // The column width didn't change, so the pen doesn't silently fatten just
    // because the text got taller.
    expect(after!.strokeScale).toBe(before!.strokeScale);
  });

  it("scales a torn block's nib by its fragment, not the gap-spanning union", () => {
    const p = placeInkStroke(torn, 0.1, 0.9, 0, 0);
    // 400 (the column), not 900 (both columns plus the gap between them).
    expect(p!.strokeScale).toBe(400 / INK_VB);
  });
});
