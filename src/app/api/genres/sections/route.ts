import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withUser } from "@/lib/route-helpers";
import { groupByGenre, applyGenrePrefs, type GenrePrefLike } from "@/lib/library/genre-sections";

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
  const [books, locations, prefRows] = await Promise.all([
    prisma.book.findMany({
      orderBy: { addedAt: "desc" },
      include: { authors: true },
    }),
    prisma.scanLocation.findMany({
      where: { enabled: true },
      select: { path: true },
    }),
    prisma.genrePref.findMany(),
  ]);
  const prefs = new Map<string, GenrePrefLike>(
    prefRows.map((p) => [p.key, { displayName: p.displayName, order: p.order, hidden: p.hidden }]),
  );
  const grouped = groupByGenre(
    books,
    locations.map((l) => l.path),
    { minBooks: MIN_BOOKS, maxPerSection: MAX_BOOKS_PER_SECTION },
  );
  // Apply the admin's ordering / renames / hides before shaping the payload.
  const sections = applyGenrePrefs(grouped, prefs).map((s) => ({
    genre: s.genre, // raw folder key — stable React key
    label: s.label, // display name (override or key)
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
