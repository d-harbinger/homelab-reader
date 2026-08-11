// Shared text normalization for fuzzy matching.
//
// Extracted from src/lib/metadata/openlibrary.ts so the duplicate-detection
// helper (src/lib/library/duplicates.ts) and the OpenLibrary matcher share one
// tokenizer rather than forking it. The `tokens()` behavior matched the original
// openlibrary tokenizer character for character until the Unicode composition
// step below was added; it still does for every input that is already composed,
// which covers all of ASCII, and the openlibrary tests stay green.

/**
 * Tokenize for fuzzy comparison: lowercase, drop punctuation, split on
 * whitespace. Unicode-aware so accented titles tokenize sensibly.
 */
export function tokens(s: string): string[] {
  return s
    .toLowerCase()
    // Recompose before stripping punctuation. A combining mark is neither a
    // letter nor a number, so the strip below turns it into a space: a title
    // that arrives DECOMPOSED ("Pen\u0303a" — n followed by a combining tilde)
    // used to tokenize as "pen a", while the same title composed ("Pe\u00f1a")
    // tokenizes as "pena". The two spellings are the same text to a reader and
    // to every font, and they come from different sources — an EPUB's own
    // metadata, a provider's JSON, a selection made on another device — so the
    // mismatch showed up as a book failing to deduplicate against itself and as
    // a synced highlight failing to find its own quote, with no symptom beyond
    // the highlight not being there. Composing first makes both spellings
    // produce one key. Text that is already composed, which includes all of
    // ASCII, is unchanged by this.
    .normalize("NFC")
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
