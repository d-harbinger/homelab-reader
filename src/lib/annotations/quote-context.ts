// Pure text-context trimmer for the EPUB text-quote sync envelope (Phase C,
// slice P0). The reader component (EpubReader.tsx) walks the DOM around a
// selection and passes the raw text immediately BEFORE the selection start and
// AFTER the selection end; this helper normalizes whitespace and trims each to
// the ~32-char prefix/suffix that disambiguates the quote when it is re-anchored
// on another device (Hypothesis-style fuzzy text matching). DOM walking stays in
// the component; only string work lives here so it is unit-testable in the node
// environment.
//
// Branches (each covered in tests/quote-context.test.ts):
//   B1 both sides empty        -> {} (no keys)
//   B2 whitespace-only input   -> normalizes to empty -> key omitted
//   B3 one side empty          -> only the non-empty key present
//   B4 short input (< limit)   -> returned whole (no truncation)
//   B5 exactly at the limit    -> returned whole (boundary, no truncation)
//   B6 long input (> limit)    -> prefix keeps the END nearest the selection,
//                                 suffix keeps the START nearest the selection
//   B7 whitespace collapse     -> runs of space/newline/tab -> a single space,
//                                 with outer whitespace trimmed
//   B8 unicode                 -> the limit counts code points, so an astral
//                                 character (emoji) is never split into a lone
//                                 UTF-16 surrogate

/** Context window size, in code points, captured on each side of a selection. */
export const QUOTE_CONTEXT_LENGTH = 32;

export interface QuoteContext {
  /** Up to QUOTE_CONTEXT_LENGTH code points immediately before the selection. */
  prefix?: string;
  /** Up to QUOTE_CONTEXT_LENGTH code points immediately after the selection. */
  suffix?: string;
}

/** Collapse whitespace runs to a single space and trim the outer edges. */
function normalize(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/** Take the last `n` code points of a string (code-point-safe). */
function tail(s: string, n: number): string {
  const cps = Array.from(s);
  return cps.length <= n ? s : cps.slice(cps.length - n).join("");
}

/** Take the first `n` code points of a string (code-point-safe). */
function head(s: string, n: number): string {
  const cps = Array.from(s);
  return cps.length <= n ? s : cps.slice(0, n).join("");
}

/**
 * Derive the prefix/suffix context for a text-quote anchor from the raw text on
 * either side of a selection. Keys are omitted (not emitted as empty strings)
 * when a side normalizes to nothing, keeping the anchor JSON additive-clean.
 */
export function extractQuoteContext(before: string, after: string): QuoteContext {
  const ctx: QuoteContext = {};
  const prefix = tail(normalize(before), QUOTE_CONTEXT_LENGTH);
  const suffix = head(normalize(after), QUOTE_CONTEXT_LENGTH);
  if (prefix) ctx.prefix = prefix;
  if (suffix) ctx.suffix = suffix;
  return ctx;
}
