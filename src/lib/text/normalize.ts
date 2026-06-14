// Shared text normalization for fuzzy matching.
//
// Extracted from src/lib/metadata/openlibrary.ts so the duplicate-detection
// helper (src/lib/library/duplicates.ts) and the OpenLibrary matcher share one
// tokenizer rather than forking it. The `tokens()` behavior is byte-identical
// to the original openlibrary tokenizer — its tests stay green.

/**
 * Tokenize for fuzzy comparison: lowercase, drop punctuation, split on
 * whitespace. Unicode-aware so accented titles tokenize sensibly.
 */
export function tokens(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * Normalize a free-text field (a title or an author name) to a single
 * whitespace-collapsed, punctuation-stripped, lowercased key. Same tokenizer as
 * `tokens()`, joined with single spaces — so "The  Pragmatic Programmer!" and
 * "the pragmatic programmer" produce the same key. Deterministic and pure.
 */
export function normalizeText(s: string): string {
  return tokens(s).join(" ");
}
