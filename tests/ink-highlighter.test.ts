// The highlighter instrument shares the ink overlay with the pen but has its
// own palette, widths, and per-kind validation so the two can't be crossed
// (a highlighter saved with a pen swatch, or vice-versa).
import { describe, it, expect } from "vitest";
import {
  HIGHLIGHTER_COLORS,
  HIGHLIGHTER_OPACITY,
  HIGHLIGHTER_WIDTHS,
  INK_COLORS,
  INK_WIDTHS,
  isColorForKind,
  isHighlighterColor,
  isHighlighterWidth,
  isInkKind,
  isWidthForKind,
} from "@/lib/ink";

describe("ink kind", () => {
  it("accepts the two instruments and nothing else", () => {
    expect(isInkKind("pen")).toBe(true);
    expect(isInkKind("highlighter")).toBe(true);
    expect(isInkKind("marker")).toBe(false);
    expect(isInkKind(undefined)).toBe(false);
    expect(isInkKind(2)).toBe(false);
  });
});

describe("highlighter palette + widths", () => {
  it("recognizes its own colors and rejects pen colors", () => {
    for (const c of HIGHLIGHTER_COLORS) expect(isHighlighterColor(c.value)).toBe(true);
    // The pen ink color is opaque near-black; it is NOT a highlighter color.
    expect(isHighlighterColor("#1c1c1e")).toBe(false);
    expect(isHighlighterColor("#123456")).toBe(false);
    expect(isHighlighterColor(123)).toBe(false);
  });

  it("recognizes its own broad widths and rejects pen nib widths", () => {
    for (const w of HIGHLIGHTER_WIDTHS) expect(isHighlighterWidth(w.value)).toBe(true);
    for (const w of INK_WIDTHS) expect(isHighlighterWidth(w.value)).toBe(false);
    expect(isHighlighterWidth(4)).toBe(false); // a pen medium
  });

  it("draws at one fixed, sane translucency", () => {
    expect(HIGHLIGHTER_OPACITY).toBeGreaterThan(0);
    expect(HIGHLIGHTER_OPACITY).toBeLessThan(1);
  });
});

describe("per-kind validation gates the API", () => {
  it("a highlighter only accepts highlighter color/width", () => {
    expect(isColorForKind("highlighter", HIGHLIGHTER_COLORS[0].value)).toBe(true);
    expect(isColorForKind("highlighter", INK_COLORS[0].value)).toBe(false);
    expect(isWidthForKind("highlighter", HIGHLIGHTER_WIDTHS[0].value)).toBe(true);
    expect(isWidthForKind("highlighter", INK_WIDTHS[0].value)).toBe(false);
  });

  it("a pen only accepts pen color/width", () => {
    expect(isColorForKind("pen", INK_COLORS[0].value)).toBe(true);
    expect(isColorForKind("pen", HIGHLIGHTER_COLORS[0].value)).toBe(false);
    expect(isWidthForKind("pen", INK_WIDTHS[0].value)).toBe(true);
    expect(isWidthForKind("pen", HIGHLIGHTER_WIDTHS[0].value)).toBe(false);
  });
});
