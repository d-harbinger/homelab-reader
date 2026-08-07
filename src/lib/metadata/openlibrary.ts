// OpenLibrary metadata enrichment.
//
// The FOSS, no-Google "brain" of sort-on-import: given the messy signals a
// freshly-scanned book carries (a title guessed from the filename, an author,
// maybe an ISBN), ask OpenLibrary for candidates and return them RANKED by a
// confidence score so the import UI can propose the best match and bulk-accept
// above a threshold. OpenLibrary is open data (Internet Archive) — no Google,
// no Goodreads/Amazon, matching the project's privacy posture.
//
// Network is injectable (`opts.fetchImpl`) so this stays a pure, fast unit.
// Every failure path returns [] rather than throwing: enrichment is best-effort
// and must never break an import.

export interface EnrichQuery {
  title?: string;
  authors?: string[];
  isbn?: string;
}

export interface MetadataSuggestion {
  source: "openlibrary";
  /** 0..1 — how well this candidate matches the query (title-weighted). */
  confidence: number;
  title?: string;
  authors: string[];
  publishedYear?: number;
  publisher?: string;
  isbn?: string;
  subjects: string[];
  coverUrl?: string;
  /** OpenLibrary work key, e.g. "/works/OL45883W" — stable handle for later. */
  workKey?: string;
}

export interface SearchOptions {
  fetchImpl?: typeof fetch;
  /** Max suggestions to return (default 5). */
  limit?: number;
  signal?: AbortSignal;
}

// --- matching ---------------------------------------------------------------

// The tokenizer is shared with the duplicate-detection helper — see
// src/lib/text/normalize.ts. (Behavior is unchanged from the inline version
// this used to carry.)
import { tokens } from "@/lib/text/normalize";

function jaccard(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const sa = new Set(a);
  const sb = new Set(b);
  let intersection = 0;
  for (const t of sa) if (sb.has(t)) intersection++;
  const union = new Set([...a, ...b]).size;
  return union === 0 ? 0 : intersection / union;
}

/** How many tokens two token lists share (set semantics). */
function sharedTokenCount(a: string[], b: string[]): number {
  const sb = new Set(b);
  let n = 0;
  for (const t of new Set(a)) if (sb.has(t)) n++;
  return n;
}

/**
 * The part of a title that comes before its subtitle. OpenLibrary stores the
 * subtitle inline after a colon — "Clean Code: A Handbook of Agile Software
 * Craftsmanship" — while a scanned filename almost never carries one.
 */
function mainTitle(s: string): string {
  const colon = s.indexOf(":");
  if (colon === -1) return s;
  const head = s.slice(0, colon).trim();
  // A title that opens with the colon has no main part to speak of.
  return head.length > 0 ? head : s;
}

/**
 * Tokens two main titles must share before the main-title comparison is
 * allowed to carry a match on its own.
 *
 * The guard is the whole reason this is safe. A one-token main title matches
 * ANY candidate whose main title is that same token, at a perfect 1.000: a
 * book the scanner could only read as "Python" would otherwise auto-shelve
 * against an arbitrary "Python: <subtitle>" primer, silently and with no
 * review. Requiring two shared tokens means a single common word can never
 * decide a match by itself — such books fall back to the full-title
 * comparison and, short of that floor, go to a human instead.
 */
const MIN_SHARED_MAIN_TITLE_TOKENS = 2;

/**
 * Title similarity, 0..1 — the better of two readings:
 *
 *   full title  — every token on both sides, the original behaviour;
 *   main titles — the parts before the subtitle, compared to each other.
 *
 * The second reading exists because a subtitle DILUTES a correct match under
 * a plain token overlap: "Clean Code" against "Clean Code: A Handbook of
 * Agile Software Craftsmanship" shares both of its tokens but scores 0.250 on
 * the full title, and 0.475 once the exact author is folded in — under the
 * 0.55 auto-shelve floor, so a certain match went to the review queue. Six of
 * twenty bench titles failed exactly that way (see tests/openlibrary-bench.test.ts).
 *
 * Taking the better of the two never lowers a score, so it can only move
 * candidates toward the floor — which is precisely why the shared-token guard
 * on the main-title reading is load-bearing rather than decorative.
 */
function titleSimilarity(queryTitle?: string, candidateTitle?: string): number {
  const full = jaccard(
    queryTitle ? tokens(queryTitle) : [],
    candidateTitle ? tokens(candidateTitle) : [],
  );
  if (!queryTitle || !candidateTitle) return full;

  const queryMain = tokens(mainTitle(queryTitle));
  const candidateMain = tokens(mainTitle(candidateTitle));
  if (sharedTokenCount(queryMain, candidateMain) < MIN_SHARED_MAIN_TITLE_TOKENS) {
    return full;
  }
  return Math.max(full, jaccard(queryMain, candidateMain));
}

/**
 * Whether the candidate's main title differs from the query's by words that
 * change WHICH BOOK it is. A token overlap cannot see this on its own: it is
 * symmetric, so it treats one extra word as a small dilution rather than as a
 * different book. "Domain-Driven Design" against "Implementing Domain-Driven
 * Design" shares three tokens of four and scores 0.750 — comfortably over the
 * auto-shelve floor, for a book by a different author about a different thing.
 *
 * The two directions are not equally suspicious:
 *
 *   words the CANDIDATE adds — "IMPLEMENTING Domain-Driven Design", "MORE
 *     Programming Pearls", "The GO Programming Language". These are the
 *     record's own title words, and they are precisely what makes it another
 *     book. A matching author does not redeem them; "More Programming Pearls"
 *     is by the author of "Programming Pearls", and scored 0.767 on the
 *     strength of it. Always disqualifying.
 *
 *   words the QUERY adds — usually noise a filename picked up along the way
 *     ("2nd Edition", "4th ed"), but sometimes a real longer title: "MODERN
 *     Operating Systems" is not "Operating Systems: Three Easy Pieces". An
 *     author that matches tells those two cases apart. With no author, nothing
 *     does — so this direction disqualifies only when no author corroborates.
 *
 * Subtitles are stripped from both sides first, so the extra words a record
 * carries after its colon still count for nothing.
 */
function mainTitlesDisagree(
  queryTitle: string | undefined,
  candidateTitle: string | undefined,
  haveAuthors: boolean,
): boolean {
  // Nothing to compare is not agreement.
  if (!queryTitle || !candidateTitle) return true;

  const queryMain = tokens(mainTitle(queryTitle));
  const candidateMain = tokens(mainTitle(candidateTitle));

  const shared = sharedTokenCount(queryMain, candidateMain);
  const candidateAdds = new Set(candidateMain).size - shared;
  if (candidateAdds > 0) return true;

  const queryAdds = new Set(queryMain).size - shared;
  return !haveAuthors && queryAdds > 0;
}

/**
 * What a match no other signal corroborates is worth: at most half.
 *
 * Confidence runs 0..1, so scaling such a candidate by a factor below the
 * auto-shelve floor puts it under that floor BY CONSTRUCTION — whatever the
 * title and author agreement, and with no threshold arithmetic to get wrong
 * (tests/openlibrary.test.ts pins the relationship). Scaling rather than
 * clamping leaves the ranking intact, and anything that scored at least twice
 * MIN_SUGGESTION_CONFIDENCE still clears it afterwards — so a held candidate
 * reaches the review queue as a suggestion instead of disappearing. Held for
 * a human, not thrown away.
 */
export const UNCORROBORATED_MATCH_CEILING = 0.5;

/**
 * Confidence that `candidate` is the book described by `query`. Title is the
 * dominant signal; author, when both sides have one, contributes a bonus.
 * Pure and deterministic — exported so the import UI (and tests) can reason
 * about the threshold.
 *
 * A candidate whose main title is not the query's title (see
 * `mainTitlesDisagree`) is held under the auto-shelve floor rather than
 * ranked out of it: without an author to corroborate, a title that merely
 * OVERLAPS is not evidence enough to write a shelf nobody will review.
 */
export function scoreMatch(
  query: EnrichQuery,
  candidate: { title?: string; authors: string[] },
): number {
  const titleScore = titleSimilarity(query.title, candidate.title);

  const haveAuthors = !!query.authors?.length && candidate.authors.length > 0;
  const score = haveAuthors
    ? titleScore * 0.7 +
      jaccard(
        tokens((query.authors ?? []).join(" ")),
        tokens(candidate.authors.join(" ")),
      ) *
        0.3
    : titleScore;

  return round(
    mainTitlesDisagree(query.title, candidate.title, haveAuthors)
      ? score * UNCORROBORATED_MATCH_CEILING
      : score,
  );
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}

// --- search -----------------------------------------------------------------

// Shape of the OpenLibrary /search.json docs we consume (everything optional —
// the API omits fields freely, so we validate each before use).
interface OlDoc {
  key?: string;
  title?: string;
  author_name?: string[];
  first_publish_year?: number;
  isbn?: string[];
  cover_i?: number;
  publisher?: string[];
  subject?: string[];
}

/**
 * How many candidates to fetch and score in order to return `limit` of them.
 * Four pages' worth, never fewer than 20 — enough that a correct-but-not-
 * top-ranked edition still gets scored, small enough to stay one modest
 * request. Exported so the tests can assert the URL rather than restate it.
 */
export const CANDIDATE_POOL = (limit: number): number => Math.max(limit * 4, 20);

function buildUrl(query: EnrichQuery, limit: number): string {
  const params = new URLSearchParams();
  if (query.isbn) {
    const clean = query.isbn.replace(/[^0-9Xx]/g, "");
    if (clean) params.set("isbn", clean);
  }
  if (query.title) params.set("title", query.title);
  if (query.authors?.length) params.set("author", query.authors.join(" "));
  // Ask for a real candidate POOL, not just the page being returned.
  //
  // OpenLibrary orders `docs` by its own relevance, which is not this
  // module's confidence order — the edition a messy filename actually
  // refers to often sits several places down ("Refactoring" returns five
  // other refactoring books before Fowler's). Asking for exactly `limit`
  // truncated the candidate set BEFORE scoring, so the right book was
  // frequently never scored at all. Score a wider pool, still return the
  // top `limit`: same single request, more for the ranking to choose from.
  params.set("limit", String(CANDIDATE_POOL(limit)));
  params.set(
    "fields",
    "key,title,author_name,first_publish_year,isbn,cover_i,publisher,subject",
  );
  return `https://openlibrary.org/search.json?${params.toString()}`;
}

function toSuggestion(doc: OlDoc, query: EnrichQuery): MetadataSuggestion {
  const authors = Array.isArray(doc.author_name) ? doc.author_name : [];
  const s: MetadataSuggestion = {
    source: "openlibrary",
    confidence: scoreMatch(query, { title: doc.title, authors }),
    title: typeof doc.title === "string" ? doc.title : undefined,
    authors,
    publishedYear:
      typeof doc.first_publish_year === "number"
        ? doc.first_publish_year
        : undefined,
    publisher:
      Array.isArray(doc.publisher) && doc.publisher.length > 0
        ? doc.publisher[0]
        : undefined,
    isbn:
      Array.isArray(doc.isbn) && doc.isbn.length > 0 ? doc.isbn[0] : undefined,
    subjects: Array.isArray(doc.subject) ? doc.subject.slice(0, 12) : [],
    coverUrl:
      typeof doc.cover_i === "number"
        ? `https://covers.openlibrary.org/b/id/${doc.cover_i}-M.jpg`
        : undefined,
    workKey: typeof doc.key === "string" ? doc.key : undefined,
  };
  return s;
}

/**
 * Why a lookup produced no suggestions. The distinction is load-bearing:
 * "answered, nothing matched" is a fact about the book, while "throttled" and
 * "failed" are facts about the network — and a caller that remembers the
 * second kind as if it were the first permanently mislabels a matchable book
 * as unmatchable. (That is exactly how a whole-library sweep started
 * reporting hundreds of false "no match" results; see the sweep in
 * src/app/api/shelves/auto/route.ts.)
 */
export type LookupOutcome = "ok" | "throttled" | "failed";

export interface LookupResult {
  outcome: LookupOutcome;
  /** Ranked suggestions, best first. Always [] unless outcome is "ok". */
  suggestions: MetadataSuggestion[];
}

// OpenLibrary is a free community service and throttles heavy callers rather
// than serving them; it answers a throttled client with 429, and 403 in the
// same role. Both mean "come back later", never "this book is unknown".
const THROTTLE_STATUSES = new Set([403, 429]);

/**
 * Query OpenLibrary and return ranked metadata suggestions PLUS why the list
 * looks the way it does. Never throws — a caller that only wants the list can
 * use `searchOpenLibrary`, while a caller that must not confuse an outage with
 * an answer reads `outcome`.
 */
export async function lookupOpenLibrary(
  query: EnrichQuery,
  opts: SearchOptions = {},
): Promise<LookupResult> {
  if (!query.title && !query.isbn && !query.authors?.length) {
    return { outcome: "ok", suggestions: [] };
  }

  const fetchImpl = opts.fetchImpl ?? fetch;
  const limit = opts.limit ?? 5;

  let data: unknown;
  try {
    const res = await fetchImpl(buildUrl(query, limit), {
      signal: opts.signal,
      headers: {
        // OpenLibrary asks clients to identify themselves.
        "User-Agent": "homelab-reader (self-hosted personal library)",
      },
    });
    if (!res.ok) {
      return {
        outcome: THROTTLE_STATUSES.has(res.status) ? "throttled" : "failed",
        suggestions: [],
      };
    }
    data = await res.json();
  } catch {
    // Network error, abort/timeout, or unparseable body — all "the service
    // did not answer", none of them "the book is unknown".
    return { outcome: "failed", suggestions: [] };
  }

  const docs =
    data && typeof data === "object" && Array.isArray((data as { docs?: unknown }).docs)
      ? ((data as { docs: OlDoc[] }).docs)
      : [];

  return {
    outcome: "ok",
    suggestions: docs
      .map((doc) => toSuggestion(doc, query))
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, limit),
  };
}

/**
 * Query OpenLibrary and return ranked metadata suggestions (best first).
 * Best-effort: any network/parse failure resolves to [] — enrichment must
 * never break an import. Callers that need to tell an empty answer apart from
 * an outage should use `lookupOpenLibrary` instead.
 */
export async function searchOpenLibrary(
  query: EnrichQuery,
  opts: SearchOptions = {},
): Promise<MetadataSuggestion[]> {
  return (await lookupOpenLibrary(query, opts)).suggestions;
}
