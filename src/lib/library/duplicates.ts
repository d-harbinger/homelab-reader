// Semantic duplicate detection (read-only report).
//
// The scanner already converges *byte-identical* files by hash (one row, last
// scan wins). This helper finds *same-work-different-file* duplicates — an epub
// and a pdf of one book, a re-download, an alternate edition — which the
// scanner leaves as distinct rows. It only REPORTS groups; it never merges,
// deletes, or repoints anything (that mutation is deferred to its own
// owner-gated plan).
//
// Grouping rules (the plan's D-C1..D-C5):
//   - D-C1  Strong key = normalized ISBN: strip non-alphanumerics, upper-case
//           (so the ISBN-10 check digit `X` matches). ISBN-13 and its ISBN-10
//           form are NOT cross-walked in v1 (documented limitation).
//   - D-C2  Fallback key = `${normalizeText(title)}|${normalizeText(author0)}`.
//           First author only; no-author books fall back to title-only.
//   - D-C3  A book is in AT MOST ONE group: ISBN groups win, and only books
//           WITHOUT an ISBN are eligible for a title+author group.
//   - D-C4  Singletons are dropped — only groups of size >= 2 are returned.
//   - D-C5  Cross-format is a signal, not a filter: each member keeps its
//           `format` so the UI can show epub-vs-pdf and let the owner prune.
//
// Pure and deterministic. Group order follows first-member title; member order
// is the caller-supplied input order (the route supplies rows by `addedAt`).

import { normalizeText } from "@/lib/text/normalize";

export interface DupBook {
  id: string;
  title: string;
  format: string;
  isbn: string | null;
  authors: string[];
  coverUrl: string | null;
}

export interface DupGroup {
  key: string;
  reason: "isbn" | "title-author";
  books: DupBook[];
}

/** Strip everything but alphanumerics and upper-case (so ISBN-10 `X` matches). */
function normalizeIsbn(isbn: string): string {
  return isbn.replace(/[^0-9A-Za-z]/g, "").toUpperCase();
}

/**
 * Group probable same-work duplicates. ISBN groups take priority; only
 * ISBN-less books are eligible for title+author grouping (a book is in at most
 * one group). Returns only groups of size >= 2. Pure + deterministic.
 */
export function groupDuplicates(books: DupBook[]): DupGroup[] {
  // Pass 1: bucket every book that carries a usable ISBN.
  const isbnBuckets = new Map<string, DupBook[]>();
  const isbnLess: DupBook[] = [];
  for (const b of books) {
    const key = b.isbn ? normalizeIsbn(b.isbn) : "";
    if (key) {
      const bucket = isbnBuckets.get(key);
      if (bucket) bucket.push(b);
      else isbnBuckets.set(key, [b]);
    } else {
      // No ISBN at all (null, empty, or non-alphanumeric) -> fallback-eligible.
      isbnLess.push(b);
    }
  }

  // Pass 2: bucket the ISBN-less remainder by normalized title + first author.
  const taBuckets = new Map<string, DupBook[]>();
  for (const b of isbnLess) {
    const key = `${normalizeText(b.title)}|${normalizeText(b.authors[0] ?? "")}`;
    const bucket = taBuckets.get(key);
    if (bucket) bucket.push(b);
    else taBuckets.set(key, [b]);
  }

  const groups: DupGroup[] = [];
  for (const [key, members] of isbnBuckets) {
    if (members.length >= 2) groups.push({ key, reason: "isbn", books: members });
  }
  for (const [key, members] of taBuckets) {
    if (members.length >= 2) {
      groups.push({ key, reason: "title-author", books: members });
    }
  }

  // Stable order: by first member's title (members keep input order).
  groups.sort((a, b) =>
    a.books[0].title.localeCompare(b.books[0].title),
  );
  return groups;
}
