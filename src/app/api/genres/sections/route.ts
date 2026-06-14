import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withUser } from "@/lib/route-helpers";
import { groupByGenre } from "@/lib/library/genre-sections";

// Folders that warrant their own home-view section. The threshold keeps
// section-per-singleton-folder noise off the home page — a folder needs at
// least MIN_BOOKS books before it earns a shelf. Mirrors /api/tags/sections.
const MIN_BOOKS = 3;
const MAX_BOOKS_PER_SECTION = 18;

// GET /api/genres/sections — home rows derived from the TOP-LEVEL on-disk
// folder each book sits under. Session-gated. Privacy: filePath is read only
// to derive the genre name (groupByGenre) and never leaves the server; the
// payload mirrors /api/tags/sections ({ sections: [{ genre, books[] }] }).
export const GET = withUser(async () => {
  const [books, locations] = await Promise.all([
    prisma.book.findMany({
      orderBy: { addedAt: "desc" },
      include: { authors: true },
    }),
    prisma.scanLocation.findMany({
      where: { enabled: true },
      select: { path: true },
    }),
  ]);
  const sections = groupByGenre(
    books,
    locations.map((l) => l.path),
    { minBooks: MIN_BOOKS, maxPerSection: MAX_BOOKS_PER_SECTION },
  ).map((s) => ({
    genre: s.genre,
    books: s.books.map((b) => ({
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
