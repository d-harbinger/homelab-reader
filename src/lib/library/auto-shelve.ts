// ═══════════════════════════════════════════════════════════════
//  auto-shelve — the long-term fix for the Unsorted pile.
//
//  PDFs embed no subject metadata, so the on-import classifier has
//  nothing to read and a PDF-heavy library starts almost entirely
//  Unsorted. This module decides a shelf for such a book by looking it
//  up on OpenLibrary using the metadata the scanner DID extract
//  (title/authors/ISBN — richer signals than the filename heuristics
//  the import-time enrich uses):
//
//    confident match with a classifiable subject → shelve it directly;
//    plausible match only                        → park it as a normal
//      pending suggestion for the existing review flow;
//    nothing usable                              → leave it Unsorted;
//    the service never answered                  → "failed", which is NOT a
//      verdict on the book and must never be remembered as one.
//
//  Fill-only like every other assignment path: callers only feed it
//  books with no shelf, so an owner's pick is never overwritten. The
//  lookup is injected, keeping the decision pure and unit-testable.
// ═══════════════════════════════════════════════════════════════
import type { EnrichQuery, MetadataSuggestion } from "@/lib/metadata/openlibrary";
import { MIN_SUGGESTION_CONFIDENCE } from "@/lib/metadata/enrich";
import { classifyGenre } from "./genre-taxonomy";

// Auto-apply floor: scoreMatch is title-weighted 0..1; above this the
// best candidate is treated as "this IS the book" and its subjects
// shelve it without review. Below it (but above the suggestion floor)
// a human confirms via the existing SuggestionsPanel.
export const AUTO_SHELVE_CONFIDENCE = 0.55;

export interface AutoShelveBook {
  id: string;
  title: string;
  isbn: string | null;
  authors: string[];
}

export type AutoShelveDecision =
  | { action: "shelved"; genre: string; subjects: string[] }
  | { action: "suggested"; suggestion: MetadataSuggestion }
  | { action: "skipped" }
  | { action: "failed" };

export async function decideShelf(
  book: AutoShelveBook,
  lookup: (query: EnrichQuery) => Promise<MetadataSuggestion[]>,
): Promise<AutoShelveDecision> {
  // A lookup that THROWS means the service did not answer. That is not a
  // verdict on the book, and callers must not remember it as one — hence a
  // distinct action rather than folding it into "skipped".
  let ranked: MetadataSuggestion[];
  try {
    ranked = await lookup({
      title: book.title,
      authors: book.authors.length ? book.authors : undefined,
      isbn: book.isbn ?? undefined,
    });
  } catch {
    return { action: "failed" };
  }

  const best = ranked[0];
  if (!best || best.confidence < MIN_SUGGESTION_CONFIDENCE) {
    return { action: "skipped" };
  }

  // Shelve on the best candidate that actually CARRIES a shelf. Candidates at
  // or above the auto floor are all "this IS the book" by this module's own
  // semantics, and OpenLibrary records the same work with wildly uneven
  // subject coverage — the top-scoring edition frequently has none at all.
  // Reading only ranked[0] therefore parked confident, obviously-classifiable
  // books in the review queue (a 1.000-confidence match with an empty
  // `subject` array was routed to a human). Never shelves below the floor.
  const confident = ranked.filter((s) => s.confidence >= AUTO_SHELVE_CONFIDENCE);
  for (const candidate of confident) {
    const genre = classifyGenre(candidate.subjects);
    if (genre) return { action: "shelved", genre, subjects: candidate.subjects };
  }

  // A plausible match that either isn't certain enough to auto-apply or
  // carries no classifiable subjects — worth a human look, not a guess.
  return { action: "suggested", suggestion: best };
}
