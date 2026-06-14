import { relativeFolder } from "./folder-tree";

export interface GenreSection<T> {
  genre: string;
  books: T[];
}

// Group books into top-level-folder sections. `roots` are the enabled scan-
// location paths. Pure + deterministic — no DB, no fs. The caller supplies an
// already-ordered (recent-first) list and a card-mapper so this stays
// path-private: filePath is read here ONLY to derive the genre and is never
// forwarded into the section payload.
//
// The top-level genre is relativeFolder(fp, roots)?.split("/")[0]. Books that
// resolve to no folder are excluded:
//   - relativeFolder === null  → not under any scan root;
//   - relativeFolder === ""    → directly under a root (no folder).
// Buckets below minBooks are dropped, the surviving buckets are ordered
// alphabetically by genre, and each is truncated to maxPerSection. Input order
// within a bucket is preserved (the caller hands an addedAt-desc list, so the
// result is recent-first per row).
export function groupByGenre<T extends { filePath: string }>(
  books: T[],
  roots: string[],
  opts: { minBooks: number; maxPerSection: number },
): GenreSection<T>[] {
  const buckets = new Map<string, T[]>();

  for (const book of books) {
    const rel = relativeFolder(book.filePath, roots);
    if (rel === null || rel === "") continue; // unrooted or directly under a root
    const genre = rel.split("/")[0];
    if (!genre) continue;
    const bucket = buckets.get(genre);
    if (bucket) bucket.push(book);
    else buckets.set(genre, [book]);
  }

  return [...buckets.entries()]
    .filter(([, b]) => b.length >= opts.minBooks)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([genre, b]) => ({ genre, books: b.slice(0, opts.maxPerSection) }));
}
