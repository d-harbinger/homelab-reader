// The connective tissue that makes the dormant enrichment pipeline live.
//
// Two halves already shipped and sit unused:
//   parseFilenameSignals — a messy filename → { title?, isbn? } signals.
//   searchOpenLibrary     — those signals → ranked MetadataSuggestion[].
// This module composes them (enrichBook) and adds the two pure decisions the
// scan hook + review screen need but don't yet have: whether a freshly-imported
// book is worth enriching (isThin, D-3a) and what accepting a suggestion would
// change (applyAcceptance, D-3d).
//
// Everything here is pure but for the injected fetch — no DB, no React, no
// real network — so it is fully unit-testable in-VM and de-risks the owner's
// later scan-wiring + review-screen sessions. Shapes are minimal and generic
// (mirroring src/lib/annotations.ts): callers pass only the fields each rule
// needs, never a whole Prisma model, so these stay standalone units.
import { parseFilenameSignals } from "./filename-signals";
import { searchOpenLibrary } from "./openlibrary";
import type { MetadataSuggestion } from "./openlibrary";

// Hard ceiling on a single OpenLibrary round-trip. enrichBook runs on the scan
// path, awaited once per thin book — and Node's global fetch has no short
// default request timeout (undici's headers/body timeouts are ~5 min), so a
// slow or hung server would otherwise stall a cold bulk scan for minutes per
// book. A bounded AbortSignal turns a hang into the same empty result every
// other failure already resolves to, preserving the best-effort contract.
const ENRICH_TIMEOUT_MS = 8000;

/**
 * Compose the dormant pipeline: filename → signals → ranked OpenLibrary
 * suggestions (best confidence first). Network is injected so this stays a pure
 * unit; best-effort like the lib it wraps — any failure resolves to [], never
 * throws, so a bad enrich can never break an import.
 *
 * @param signalsSource the book's file path (basename drives the signals).
 * @param fetchImpl     injected fetch (a test stub, or the real fetch in prod).
 */
export async function enrichBook(
  signalsSource: string,
  fetchImpl: typeof fetch,
): Promise<MetadataSuggestion[]> {
  const query = parseFilenameSignals(signalsSource);
  // searchOpenLibrary already short-circuits to [] when the query is empty and
  // swallows network/parse errors (an abort included), so no try/catch is needed
  // here. The bounded signal caps a slow/hung request at ENRICH_TIMEOUT_MS so it
  // can never stall the scan loop this is awaited inside.
  return searchOpenLibrary(query, {
    fetchImpl,
    signal: AbortSignal.timeout(ENRICH_TIMEOUT_MS),
  });
}

/** Minimal book shape the thin-check needs (D-3a). */
export interface ThinBookShape {
  /** The extracted title (the Book.title column). */
  title: string;
  /** The book's file path — used to derive the filename-fallback title. */
  filePath: string;
  /** The extracted ISBN, if the file carried one. */
  isbn?: string | null;
  /** The linked authors, if any (Book.authors relation). */
  authors?: { name?: string | null }[] | null;
}

/**
 * D-3a "thin" trigger: enrich on scan only when the extracted metadata is weak,
 * so a well-tagged file isn't needlessly queried. A book is thin when ANY of:
 *   - it has no ISBN, OR
 *   - its title is just the filename fallback (nothing better was extracted), OR
 *   - it has no author.
 */
export function isThin(book: ThinBookShape): boolean {
  if (!book.isbn) return true;

  const fallbackTitle = parseFilenameSignals(book.filePath).title;
  if (fallbackTitle && book.title.trim() === fallbackTitle.trim()) return true;

  const hasAuthor = !!book.authors?.some((a) => !!a.name && a.name.trim() !== "");
  if (!hasAuthor) return true;

  return false;
}

/** Minimal book shape the acceptance diff reads (D-3d) — the write-back fields. */
export interface AcceptBookShape {
  isbn?: string | null;
  title?: string | null;
  subtitle?: string | null;
  publisher?: string | null;
  publishedAt?: Date | null;
  description?: string | null;
  language?: string | null;
  pageCount?: number | null;
}

/**
 * The field diff accepting a suggestion would write. The scalar keys map 1:1 to
 * Book columns; `tagNames` is the subjects→tags fill, which the caller turns
 * into Tag relation writes (a name list, not a scalar column). A key is present
 * only when the suggestion actually changes that field, so the caller can spread
 * the diff straight onto an update payload.
 */
export interface BookFieldDiff {
  isbn?: string;
  title?: string;
  subtitle?: string;
  publisher?: string;
  publishedAt?: Date;
  description?: string;
  language?: string;
  pageCount?: number;
  /** Subject names to attach as tags (D-3d: subjects → tags). */
  tagNames?: string[];
}

/** True when a Book field is empty/fallback and may be filled. */
function isEmpty(v: unknown): boolean {
  return v === null || v === undefined || (typeof v === "string" && v.trim() === "");
}

/**
 * D-3d write-back policy: compute the field diff accepting `suggestion` against
 * `book` would produce. By default only empty/fallback fields are filled — the
 * metadata the file actually carried is never clobbered — UNLESS `force` is set,
 * which overwrites even a present field (the review UI's per-field "force
 * overwrite"). Subjects always map to `tagNames` when present (tags are additive,
 * not an overwrite of an existing scalar). Pure: returns the diff, writes nothing.
 */
export function applyAcceptance(
  book: AcceptBookShape,
  suggestion: MetadataSuggestion,
  { force }: { force: boolean },
): BookFieldDiff {
  const diff: BookFieldDiff = {};

  // Fill a scalar field when the suggestion carries a value AND (force OR the
  // current field is empty).
  const fill = <K extends keyof BookFieldDiff & keyof AcceptBookShape>(
    key: K,
    value: BookFieldDiff[K] | undefined,
  ): void => {
    if (value === undefined || value === null) return;
    if (force || isEmpty(book[key])) {
      diff[key] = value;
    }
  };

  fill("isbn", suggestion.isbn);
  fill("title", suggestion.title);
  fill("publisher", suggestion.publisher);
  fill(
    "publishedAt",
    suggestion.publishedYear !== undefined
      ? new Date(Date.UTC(suggestion.publishedYear, 0, 1))
      : undefined,
  );

  // Subjects → tag names (D-3d high-value fill). Tags are additive, so this is
  // emitted whenever the suggestion has any, independent of empty-only semantics.
  if (suggestion.subjects.length > 0) {
    diff.tagNames = [...suggestion.subjects];
  }

  return diff;
}
