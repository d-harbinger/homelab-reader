// Pure unit tests for the text-quote annotation envelope (Phase C, slice P1).
//
// The envelope is the wire shape an android-created highlight carries across the
// sync channel BEFORE the web reader resolves it to a CFI. This module validates
// it once, so both auth front doors (session + OPDS) get the same bounds via the
// shared highlights lib. DOM/resolution logic lives elsewhere; only shape
// validation is here, unit-testable in the node environment.
//
// Branches (each covered below):
//   isTextQuoteAnchor
//     G1 object with type "text-quote"        -> true
//     G2 null / non-object                    -> false
//     G3 object with a different type          -> false
//     G4 object with no type                   -> false
//   parseTextQuoteAnchor
//     P1  quote only (minimal)                 -> ok, only quote key
//     P2  all fields present                   -> ok, all keys round-trip
//     P3  quote missing                        -> error (required)
//     P4  quote empty string                   -> error (required)
//     P5  quote non-string                     -> error
//     P6  quote exactly 2000 chars             -> ok (boundary)
//     P7  quote 2001 chars                     -> error (oversize)
//     P8  prefix 201 chars                     -> error (bound)
//     P9  suffix 201 chars                     -> error (bound)
//     P10 chapterHref 501 chars                -> error (bound)
//     P11 progression 1.5 (numeric high)       -> ok, clamped to 1
//     P12 progression -0.5 (numeric low)       -> ok, clamped to 0
//     P13 progression a string                 -> error (bad-progression)
//     P14 progression NaN/Infinity             -> error (bad-progression)
//     P15 non-object input                     -> error
//     P16 optional keys omitted, not empty     -> ok, absent keys stay absent

import { describe, it, expect } from "vitest";
import {
  isTextQuoteAnchor,
  parseTextQuoteAnchor,
  QUOTE_MAX_LENGTH,
  CONTEXT_MAX_LENGTH,
  CHAPTER_HREF_MAX_LENGTH,
} from "@/lib/annotations/envelope";

describe("isTextQuoteAnchor", () => {
  it("G1 returns true for an object whose type is 'text-quote'", () => {
    expect(isTextQuoteAnchor({ type: "text-quote", quote: "x" })).toBe(true);
  });
  it("G2 returns false for null and non-objects", () => {
    expect(isTextQuoteAnchor(null)).toBe(false);
    expect(isTextQuoteAnchor("text-quote")).toBe(false);
    expect(isTextQuoteAnchor(42)).toBe(false);
  });
  it("G3 returns false for a different anchor type", () => {
    expect(isTextQuoteAnchor({ type: "epub-cfi-range", cfi: "/6/2" })).toBe(false);
  });
  it("G4 returns false for an object with no type", () => {
    expect(isTextQuoteAnchor({ quote: "x" })).toBe(false);
  });
});

describe("parseTextQuoteAnchor", () => {
  it("P1 accepts a minimal quote-only anchor and keeps only the quote key", () => {
    const r = parseTextQuoteAnchor({ type: "text-quote", quote: "hello" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.envelope).toEqual({ type: "text-quote", quote: "hello" });
    }
  });

  it("P2 accepts and round-trips all envelope fields", () => {
    const full = {
      type: "text-quote",
      quote: "the selected text",
      prefix: "words before ",
      suffix: " words after",
      chapterHref: "OEBPS/chapter03.xhtml",
      progression: 0.42,
    };
    const r = parseTextQuoteAnchor(full);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.envelope).toEqual(full);
  });

  it("P3 rejects a missing quote", () => {
    const r = parseTextQuoteAnchor({ type: "text-quote" });
    expect(r.ok).toBe(false);
  });

  it("P4 rejects an empty-string quote", () => {
    const r = parseTextQuoteAnchor({ type: "text-quote", quote: "" });
    expect(r.ok).toBe(false);
  });

  it("P5 rejects a non-string quote", () => {
    const r = parseTextQuoteAnchor({ type: "text-quote", quote: 123 });
    expect(r.ok).toBe(false);
  });

  it("P6 accepts a quote at exactly the length limit", () => {
    const r = parseTextQuoteAnchor({
      type: "text-quote",
      quote: "a".repeat(QUOTE_MAX_LENGTH),
    });
    expect(r.ok).toBe(true);
  });

  it("P7 rejects an oversize quote", () => {
    const r = parseTextQuoteAnchor({
      type: "text-quote",
      quote: "a".repeat(QUOTE_MAX_LENGTH + 1),
    });
    expect(r.ok).toBe(false);
  });

  it("P8 rejects an oversize prefix", () => {
    const r = parseTextQuoteAnchor({
      type: "text-quote",
      quote: "x",
      prefix: "a".repeat(CONTEXT_MAX_LENGTH + 1),
    });
    expect(r.ok).toBe(false);
  });

  it("P9 rejects an oversize suffix", () => {
    const r = parseTextQuoteAnchor({
      type: "text-quote",
      quote: "x",
      suffix: "a".repeat(CONTEXT_MAX_LENGTH + 1),
    });
    expect(r.ok).toBe(false);
  });

  it("P10 rejects an oversize chapterHref", () => {
    const r = parseTextQuoteAnchor({
      type: "text-quote",
      quote: "x",
      chapterHref: "a".repeat(CHAPTER_HREF_MAX_LENGTH + 1),
    });
    expect(r.ok).toBe(false);
  });

  it("P11 clamps an above-range progression to 1", () => {
    const r = parseTextQuoteAnchor({ type: "text-quote", quote: "x", progression: 1.5 });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.envelope.progression).toBe(1);
  });

  it("P12 clamps a below-range progression to 0", () => {
    const r = parseTextQuoteAnchor({ type: "text-quote", quote: "x", progression: -0.5 });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.envelope.progression).toBe(0);
  });

  it("P13 rejects a non-numeric progression", () => {
    const r = parseTextQuoteAnchor({
      type: "text-quote",
      quote: "x",
      progression: "half",
    });
    expect(r.ok).toBe(false);
  });

  it("P14 rejects a non-finite progression", () => {
    expect(
      parseTextQuoteAnchor({ type: "text-quote", quote: "x", progression: Infinity }).ok,
    ).toBe(false);
    expect(
      parseTextQuoteAnchor({ type: "text-quote", quote: "x", progression: NaN }).ok,
    ).toBe(false);
  });

  it("P15 rejects non-object input", () => {
    expect(parseTextQuoteAnchor(null).ok).toBe(false);
    expect(parseTextQuoteAnchor("text-quote").ok).toBe(false);
  });

  it("P16 omits absent optional keys rather than emitting empty strings", () => {
    const r = parseTextQuoteAnchor({ type: "text-quote", quote: "x" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect("prefix" in r.envelope).toBe(false);
      expect("suffix" in r.envelope).toBe(false);
      expect("chapterHref" in r.envelope).toBe(false);
      expect("progression" in r.envelope).toBe(false);
    }
  });
});
