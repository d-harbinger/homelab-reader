// Minimal ambient types for `dom-anchor-text-quote` (v4), which ships no
// declarations of its own. Only the surface the EPUB reader uses is typed here:
// `toRange`, which fuzzy-matches a text-quote selector (exact text plus optional
// surrounding context) against a DOM subtree and returns the matched Range, or
// null when the quote can't be found. See src/lib/annotations/resolve-textquote.ts
// for how this feeds the one-time text-quote → CFI upgrade.
declare module "dom-anchor-text-quote" {
  export interface TextQuoteSelector {
    exact: string;
    prefix?: string;
    suffix?: string;
  }
  export interface TextQuoteOptions {
    hint?: number;
  }
  export function toRange(
    root: Node,
    selector: TextQuoteSelector,
    options?: TextQuoteOptions,
  ): Range | null;
  export function fromRange(
    root: Node,
    range: Range,
  ): TextQuoteSelector;
}
