// ═══════════════════════════════════════════════════════════════
//  Property tests for the selection-context trimmer.
//
//  WHY THESE AND NOT MORE EXAMPLES. tests/quote-context.test.ts walks the
//  eight branches this module documents. What it cannot walk is the input:
//  the reader component hands over whatever text the DOM held around the
//  selection, which is an arbitrary run of a book — any script, any
//  invisible formatting character, any length.
//
//  The prefix and suffix exist to disambiguate a quote that appears more
//  than once in a chapter. So the invariant that matters is DIRECTION: the
//  prefix has to be the text nearest the selection's start and the suffix
//  the text nearest its end. A trimmer that kept the far end instead would
//  still produce plausible-looking context, and would disambiguate toward
//  the wrong occurrence — a highlight landing on a different paragraph
//  that happens to contain the same sentence.
// ═══════════════════════════════════════════════════════════════

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { extractQuoteContext, QUOTE_CONTEXT_LENGTH } from "@/lib/annotations/quote-context";

function show(v: unknown): string {
  try {
    return fc.stringify(v);
  } catch {
    return "<unprintable>";
  }
}

// The same whitespace collapse the module documents, restated here so the
// direction assertions have something to compare against. This is the one
// piece of the implementation the tests have to know: everything else is
// checked as a claim about the result.
const collapse = (s: string) => s.replace(/\s+/g, " ").trim();

const anyText = fc.oneof(
  { weight: 3, arbitrary: fc.string({ unit: "binary" }) },
  { weight: 3, arbitrary: fc.string({ unit: "grapheme", maxLength: 80 }) },
  { weight: 2, arbitrary: fc.string({ unit: "grapheme", minLength: 40, maxLength: 400 }) },
  {
    weight: 1,
    arbitrary: fc.constantFrom(
      "",
      "        ",
      "\t\n\r\f\v ",
      " ",
      "​‌‍",
      "‮ reversed ‬",
      "é́́ combining",
      "\ud800",
      "\udfff\ud800",
      "🙂🙂🙂🙂🙂🙂🙂🙂🙂🙂🙂🙂🙂🙂🙂🙂🙂🙂🙂🙂🙂🙂🙂🙂🙂🙂🙂🙂🙂🙂🙂🙂🙂🙂🙂",
    ),
  },
);

describe("quote-context — total, bounded, and never empty-keyed", () => {
  it("Q1: returns a context for any pair of strings, never throws", () => {
    // This runs at highlight creation. A throw here loses the highlight the
    // reader just made, before it is ever sent anywhere.
    fc.assert(
      fc.property(anyText, anyText, (before, after) => {
        const ctx = extractQuoteContext(before, after);
        expect(typeof ctx, `no context for ${show([before, after])}`).toBe("object");
      }),
      { numRuns: 2000 },
    );
  });

  it("Q2: a present key is non-empty and within the code-point limit", () => {
    // An empty string key would be stored as noise in the anchor JSON and
    // would weaken the disambiguation it exists to provide; over-length
    // context is over the envelope's own context bound.
    let withPrefix = 0;
    let withSuffix = 0;
    fc.assert(
      fc.property(anyText, anyText, (before, after) => {
        const ctx = extractQuoteContext(before, after);
        for (const [k, v] of Object.entries(ctx)) {
          expect(typeof v, `${k} is not a string`).toBe("string");
          expect((v as string).length, `${k} is empty`).toBeGreaterThan(0);
          expect(
            Array.from(v as string).length,
            `${k} over the limit for ${show([before, after])}`,
          ).toBeLessThanOrEqual(QUOTE_CONTEXT_LENGTH);
        }
        if (ctx.prefix !== undefined) withPrefix += 1;
        if (ctx.suffix !== undefined) withSuffix += 1;
      }),
      { numRuns: 2000 },
    );
    // Corpus check: mostly-empty inputs would make this vacuous.
    expect(withPrefix).toBeGreaterThan(1000);
    expect(withSuffix).toBeGreaterThan(1000);
  });

  it("Q3: the collapsed text is empty exactly when the key is omitted", () => {
    fc.assert(
      fc.property(anyText, anyText, (before, after) => {
        const ctx = extractQuoteContext(before, after);
        expect(ctx.prefix === undefined, `prefix presence wrong for ${show(before)}`).toBe(
          collapse(before).length === 0,
        );
        expect(ctx.suffix === undefined, `suffix presence wrong for ${show(after)}`).toBe(
          collapse(after).length === 0,
        );
      }),
      { numRuns: 2000 },
    );
  });
});

describe("quote-context — the context points at the selection", () => {
  it("Q4: the prefix ends at the selection and the suffix starts at it", () => {
    // The direction invariant. Keeping the far end of a long run would
    // disambiguate toward a different occurrence of the same sentence.
    fc.assert(
      fc.property(anyText, anyText, (before, after) => {
        const ctx = extractQuoteContext(before, after);
        if (ctx.prefix !== undefined) {
          expect(
            collapse(before).endsWith(ctx.prefix),
            `prefix is not the text nearest the selection: ${show(before)}`,
          ).toBe(true);
        }
        if (ctx.suffix !== undefined) {
          expect(
            collapse(after).startsWith(ctx.suffix),
            `suffix is not the text nearest the selection: ${show(after)}`,
          ).toBe(true);
        }
      }),
      { numRuns: 3000 },
    );
  });

  it("Q5: short context is kept whole, never truncated", () => {
    // Below the limit, throwing any of it away would weaken a disambiguator
    // for no gain.
    fc.assert(
      fc.property(anyText, anyText, (before, after) => {
        const cb = collapse(before);
        const ca = collapse(after);
        const ctx = extractQuoteContext(before, after);
        if (cb.length > 0 && Array.from(cb).length <= QUOTE_CONTEXT_LENGTH) {
          expect(ctx.prefix, `short prefix truncated: ${show(before)}`).toBe(cb);
        }
        if (ca.length > 0 && Array.from(ca).length <= QUOTE_CONTEXT_LENGTH) {
          expect(ctx.suffix, `short suffix truncated: ${show(after)}`).toBe(ca);
        }
      }),
      { numRuns: 2000 },
    );
  });

  it("Q6: well-formed text in, well-formed text out", () => {
    // The limit counts code points, so an astral character (an emoji, or any
    // character outside the basic plane) must never be cut in half into a lone
    // surrogate — that is a character the receiving device cannot render and
    // JSON cannot cleanly carry.
    let wellFormedCases = 0;
    fc.assert(
      fc.property(anyText, anyText, (before, after) => {
        if (!before.isWellFormed() || !after.isWellFormed()) return;
        wellFormedCases += 1;
        const ctx = extractQuoteContext(before, after);
        for (const [k, v] of Object.entries(ctx)) {
          expect((v as string).isWellFormed(), `${k} carries a lone surrogate`).toBe(true);
        }
      }),
      { numRuns: 2000 },
    );
    expect(wellFormedCases).toBeGreaterThan(800);
  });
});

describe("quote-context — bounded work on unbounded input", () => {
  it("Q7: 200k characters on each side trim in well under two seconds", () => {
    // The component passes whatever the DOM walk collected. The whitespace
    // collapse is a regular expression over that, so a long run of whitespace
    // or of astral characters must not turn a highlight into a frozen tab.
    const inputs: [string, string][] = [
      [" ".repeat(200000), " ".repeat(200000)],
      ["a".repeat(200000), "b".repeat(200000)],
      ["a \n\t".repeat(50000), "\r\n b".repeat(50000)],
      ["🙂".repeat(100000), "🙂".repeat(100000)],
    ];
    for (const [before, after] of inputs) {
      const t0 = Date.now();
      const ctx = extractQuoteContext(before, after);
      const ms = Date.now() - t0;
      expect(ms, `extractQuoteContext took ${ms}ms`).toBeLessThan(2000);
      if (ctx.prefix !== undefined) {
        expect(Array.from(ctx.prefix).length).toBeLessThanOrEqual(QUOTE_CONTEXT_LENGTH);
      }
    }
  });
});
