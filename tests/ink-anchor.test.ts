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
import { describe, it, expect } from "vitest";
import { INK_CFI_MAX_LENGTH, parseInkAnchor, pickFragment } from "@/lib/ink";

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
