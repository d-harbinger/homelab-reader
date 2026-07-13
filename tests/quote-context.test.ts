// QUOTE-CONTEXT-01 — unit tests for the pure text-context trimmer used at
// EPUB highlight creation (Phase C, slice P0). The reader component walks the
// DOM around a selection and hands this helper the raw text immediately BEFORE
// the selection start and AFTER the selection end; the helper normalizes and
// trims those to the ~32-char prefix/suffix the text-quote sync envelope wants.
//
// Every branch of extractQuoteContext is enumerated here (mirrors the branch
// list in src/lib/annotations/quote-context.ts's header comment):
//
//   B1 both sides empty           -> {} (no keys)
//   B2 whitespace-only input      -> normalizes to empty -> key omitted
//   B3 one side empty             -> only the non-empty key present
//   B4 short input (< limit)      -> returned whole (no truncation)
//   B5 exactly at the limit       -> returned whole (boundary, no truncation)
//   B6 long input (> limit)       -> prefix keeps the END nearest the selection,
//                                     suffix keeps the START nearest the selection
//   B7 whitespace collapse        -> runs of space/newline/tab -> a single space
//   B8 unicode                    -> limit counts code points; never splits an
//                                     astral char (emoji) into a lone surrogate

import { describe, it, expect } from "vitest";
import {
  extractQuoteContext,
  QUOTE_CONTEXT_LENGTH,
} from "@/lib/annotations/quote-context";

describe("extractQuoteContext", () => {
  it("B1: returns no keys when both sides are empty", () => {
    expect(extractQuoteContext("", "")).toEqual({});
  });

  it("B2: omits keys for whitespace-only input", () => {
    expect(extractQuoteContext("   \n\t  ", "  \n ")).toEqual({});
  });

  it("B3: includes only the non-empty side", () => {
    expect(extractQuoteContext("before text", "")).toEqual({
      prefix: "before text",
    });
    expect(extractQuoteContext("", "after text")).toEqual({
      suffix: "after text",
    });
  });

  it("B4: returns short input whole (no truncation)", () => {
    expect(extractQuoteContext("a short bit", "and after")).toEqual({
      prefix: "a short bit",
      suffix: "and after",
    });
  });

  it("B5: returns input of exactly the limit length whole", () => {
    const exact = "x".repeat(QUOTE_CONTEXT_LENGTH);
    const { prefix, suffix } = extractQuoteContext(exact, exact);
    expect(prefix).toBe(exact);
    expect(suffix).toBe(exact);
    expect(prefix).toHaveLength(QUOTE_CONTEXT_LENGTH);
  });

  it("B6: prefix keeps the trailing chars, suffix keeps the leading chars", () => {
    // 40 distinct chars each so position is unambiguous.
    const before = "0123456789ABCDEFGHIJ0123456789ABCDEFGHIJ"; // 40 chars
    const after = "abcdefghijKLMNOPQRSTabcdefghijKLMNOPQRST"; // 40 chars
    const { prefix, suffix } = extractQuoteContext(before, after);
    // prefix = LAST 32 chars (the text nearest the selection start)
    expect(prefix).toBe(before.slice(-QUOTE_CONTEXT_LENGTH));
    expect(prefix).toHaveLength(QUOTE_CONTEXT_LENGTH);
    // suffix = FIRST 32 chars (the text nearest the selection end)
    expect(suffix).toBe(after.slice(0, QUOTE_CONTEXT_LENGTH));
    expect(suffix).toHaveLength(QUOTE_CONTEXT_LENGTH);
  });

  it("B7: collapses whitespace runs (space/newline/tab) to a single space", () => {
    expect(
      extractQuoteContext("end of\n\tprevious   sentence", "next\n\nparagraph"),
    ).toEqual({
      prefix: "end of previous sentence",
      suffix: "next paragraph",
    });
  });

  it("B7: trims leading/trailing whitespace around the collapsed context", () => {
    expect(extractQuoteContext("  padded before  ", "  padded after  ")).toEqual(
      { prefix: "padded before", suffix: "padded after" },
    );
  });

  it("B8: counts the limit in code points and never splits an astral char", () => {
    const before = "😀".repeat(40); // 40 emoji, each a surrogate pair in UTF-16
    const after = "😀".repeat(40);
    const { prefix, suffix } = extractQuoteContext(before, after);
    // Exactly 32 code points, not 32 UTF-16 units (which would be 16 emoji).
    expect(Array.from(prefix ?? "")).toHaveLength(QUOTE_CONTEXT_LENGTH);
    expect(Array.from(suffix ?? "")).toHaveLength(QUOTE_CONTEXT_LENGTH);
    // No lone surrogate / replacement char left by a mid-pair slice.
    expect(prefix).not.toContain("�");
    expect(prefix).toBe("😀".repeat(QUOTE_CONTEXT_LENGTH));
    expect(suffix).toBe("😀".repeat(QUOTE_CONTEXT_LENGTH));
  });

  it("B8: preserves whole multi-byte characters within the limit", () => {
    const { prefix } = extractQuoteContext("café résumé naïve", "");
    expect(prefix).toBe("café résumé naïve");
  });
});
