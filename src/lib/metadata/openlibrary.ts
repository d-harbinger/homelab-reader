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

/**
 * Confidence that `candidate` is the book described by `query`. Title is the
 * dominant signal; author, when both sides have one, contributes a bonus.
 * Pure and deterministic — exported so the import UI (and tests) can reason
 * about the threshold.
 */
export function scoreMatch(
  query: EnrichQuery,
  candidate: { title?: string; authors: string[] },
): number {
  const titleScore = jaccard(
    query.title ? tokens(query.title) : [],
    candidate.title ? tokens(candidate.title) : [],
  );

  const haveAuthors = !!query.authors?.length && candidate.authors.length > 0;
  if (!haveAuthors) return round(titleScore);

  const authorScore = jaccard(
    tokens((query.authors ?? []).join(" ")),
    tokens(candidate.authors.join(" ")),
  );
  return round(titleScore * 0.7 + authorScore * 0.3);
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

function buildUrl(query: EnrichQuery, limit: number): string {
  const params = new URLSearchParams();
  if (query.isbn) {
    const clean = query.isbn.replace(/[^0-9Xx]/g, "");
    if (clean) params.set("isbn", clean);
  }
  if (query.title) params.set("title", query.title);
  if (query.authors?.length) params.set("author", query.authors.join(" "));
  // Ask for a few extra so confidence ranking has something to sort.
  params.set("limit", String(Math.max(limit, 5)));
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
 * Query OpenLibrary and return ranked metadata suggestions (best first).
 * Best-effort: any network/parse failure resolves to [] — enrichment must
 * never break an import.
 */
export async function searchOpenLibrary(
  query: EnrichQuery,
  opts: SearchOptions = {},
): Promise<MetadataSuggestion[]> {
  if (!query.title && !query.isbn && !query.authors?.length) return [];

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
    if (!res.ok) return [];
    data = await res.json();
  } catch {
    return [];
  }

  const docs =
    data && typeof data === "object" && Array.isArray((data as { docs?: unknown }).docs)
      ? ((data as { docs: OlDoc[] }).docs)
      : [];

  return docs
    .map((doc) => toSuggestion(doc, query))
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, limit);
}
