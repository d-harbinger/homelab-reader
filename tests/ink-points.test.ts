// parseInkPoints — the wire guard for a stroke's captured points.
//
// Two coordinate contracts share this parser. A PDF (page-anchored) stroke's
// fractions are of the whole page, which IS the drawing canvas, so nothing
// legitimately lands outside 0..1 and the parser clamps to it. An EPUB
// (block-anchored) stroke's fractions are of the ONE text block it started on —
// a reference frame, not a cage — and a freehand mark routinely runs past that
// small block onto the rest of the page, so its position must survive intact.
// Pressure is a true 0..1 quantity for both and is always clamped.
//
// The clamp-to-block bug: an EPUB stroke that left its anchor block had every
// outside point pinned to the block edge, so the ink slid straight along that
// edge instead of following the pen. Freeing position here is half the fix; the
// capture step (EpubInkLayer.toPoint) is the other half.
import { describe, it, expect } from "vitest";
import { parseInkPoints } from "@/lib/ink";

describe("parseInkPoints — page strokes (PDF) stay caged to the page", () => {
  it("clamps position and pressure to 0..1 by default", () => {
    expect(parseInkPoints([[1.5, -0.3, 0.9]])).toEqual([[1, 0, 0.9]]);
    expect(parseInkPoints([[0.5, 0.5, 1.7]])).toEqual([[0.5, 0.5, 1]]);
  });

  it("keeps an in-range stroke unchanged", () => {
    expect(parseInkPoints([[0.2, 0.8, 0.4]])).toEqual([[0.2, 0.8, 0.4]]);
  });

  it("rejects empty, non-array, and non-finite input", () => {
    expect(parseInkPoints([])).toBeNull();
    expect(parseInkPoints("nope")).toBeNull();
    expect(parseInkPoints([[Number.NaN, 0.5]])).toBeNull();
    expect(parseInkPoints([[0.5, Infinity]])).toBeNull();
  });

  it("defaults a missing pressure to 0.5", () => {
    expect(parseInkPoints([[0.3, 0.7]])).toEqual([[0.3, 0.7, 0.5]]);
  });
});

describe("parseInkPoints — block strokes (EPUB) may leave their anchor block", () => {
  it("preserves position outside 0..1 so ink follows the pen past the block", () => {
    // A mark started on a short paragraph and dragged down onto the next: y
    // runs well past 1, x drifts left of 0. Both must survive, un-pinned.
    expect(
      parseInkPoints([[0.5, 0.5, 0.6], [-0.4, 2.3, 0.6]], { allowOverflow: true }),
    ).toEqual([[0.5, 0.5, 0.6], [-0.4, 2.3, 0.6]]);
  });

  it("still clamps pressure to 0..1 even when position is free", () => {
    expect(parseInkPoints([[1.8, -0.9, 1.5]], { allowOverflow: true })).toEqual([
      [1.8, -0.9, 1],
    ]);
  });

  it("still rejects non-finite position", () => {
    expect(parseInkPoints([[Number.NaN, 2, 0.5]], { allowOverflow: true })).toBeNull();
    expect(parseInkPoints([[2, Infinity, 0.5]], { allowOverflow: true })).toBeNull();
  });
});
