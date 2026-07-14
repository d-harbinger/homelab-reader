import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withUser } from "@/lib/route-helpers";
import { GENRES, UNSORTED } from "@/lib/library/genre-taxonomy";

// GET /api/shelves/sections — the BOOKSTORE view: home rows grouped by
// the metadata-assigned Book.genre (lib/library/genre-taxonomy), NOT by
// on-disk folders (that's /api/genres/sections, the disk-truth view).
// Session-gated; payload shape mirrors the other section routes.
//
// No minimum-books threshold: the taxonomy is a bounded shelf list, so
// a shelf with two books is signal, not noise. Shelves appear in
// taxonomy order (the order a store would walk you through), with the
// Unsorted pile — books nothing classified — always last as the
// standing to-organize queue.
const MAX_BOOKS_PER_SECTION = 18;

export const GET = withUser(async () => {
  const books = await prisma.book.findMany({
    orderBy: { addedAt: "desc" },
    include: { authors: true },
  });

  const byGenre = new Map<string, typeof books>();
  for (const book of books) {
    const shelf = book.genre ?? UNSORTED;
    const bucket = byGenre.get(shelf);
    if (bucket) bucket.push(book);
    else byGenre.set(shelf, [book]);
  }

  // Custom shelf names (owner-set, outside the taxonomy) slot between
  // the taxonomy shelves and the Unsorted pile, alphabetically.
  const custom = [...byGenre.keys()]
    .filter((g) => g !== UNSORTED && !GENRES.includes(g))
    .sort((a, b) => a.localeCompare(b));
  const order = [...GENRES, ...custom, UNSORTED];
  const sections = order
    .filter((shelf) => byGenre.has(shelf))
    .map((shelf) => ({
      genre: shelf,
      label: shelf,
      count: byGenre.get(shelf)!.length,
      books: byGenre
        .get(shelf)!
        .slice(0, MAX_BOOKS_PER_SECTION)
        .map((b) => ({
          id: b.id,
          title: b.title,
          format: b.format,
          authors: b.authors.map((a) => a.name),
          pageCount: b.pageCount,
          coverUrl: b.coverPath ? `/api/covers/${b.id}` : null,
        })),
    }));

  return NextResponse.json({ sections });
});
