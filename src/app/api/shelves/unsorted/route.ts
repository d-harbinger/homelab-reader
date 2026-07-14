import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withUser } from "@/lib/route-helpers";

// GET /api/shelves/unsorted — the sorting bench's worklist: every book
// with no shelf yet, oldest first (the long-forgotten dump bottom
// surfaces instead of hiding). Session-gated like the other reads.
export const GET = withUser(async () => {
  const books = await prisma.book.findMany({
    where: { genre: null },
    orderBy: { addedAt: "asc" },
    select: {
      id: true,
      title: true,
      genre: true,
      authors: { select: { name: true } },
    },
  });
  return NextResponse.json({
    books: books.map((b) => ({
      id: b.id,
      title: b.title,
      genre: b.genre,
      authors: b.authors.map((a) => a.name),
    })),
  });
});
