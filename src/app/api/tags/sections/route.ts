import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// Tags that warrant their own home-view section. The threshold keeps
// section-per-singleton-tag noise off the home page — a tag needs at
// least MIN_BOOKS books before it earns a shelf.
const MIN_BOOKS = 3;
const MAX_BOOKS_PER_SECTION = 18;

// GET /api/tags/sections — returns array of { tag, books[] } for tags
// with enough books to warrant a home-view section, ordered by book count.
export async function GET() {
  const tags = await prisma.tag.findMany({
    include: {
      books: {
        include: { authors: true },
        orderBy: { addedAt: "desc" },
        take: MAX_BOOKS_PER_SECTION,
      },
    },
  });

  const qualifying = tags
    .filter((t) => t.books.length >= MIN_BOOKS)
    .sort((a, b) => b.books.length - a.books.length);

  return NextResponse.json({
    sections: qualifying.map((t) => ({
      tag: t.name,
      books: t.books.map((b) => ({
        id: b.id,
        title: b.title,
        format: b.format,
        authors: b.authors.map((a) => a.name),
        pageCount: b.pageCount,
        coverUrl: b.coverPath ? `/api/covers/${b.id}` : null,
      })),
    })),
  });
}
