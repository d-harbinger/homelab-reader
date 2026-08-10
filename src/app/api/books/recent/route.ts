import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withUser } from "@/lib/route-helpers";

const LIMIT = 18;

// GET /api/books/recent — newest additions, for the home "Recently
// Added" shelf. Mirrors the BookCard shape /api/books returns so the
// home view can drop them straight in.
// Session-gated: the catalogue is not public. The gate is the shared
// wrapper rather than the middleware alone, so the route defends itself even
// if a matcher exemption ever grows to cover it.
export const GET = withUser(async () => {
  const books = await prisma.book.findMany({
    orderBy: { addedAt: "desc" },
    take: LIMIT,
    include: { authors: true },
  });

  return NextResponse.json({
    books: books.map((b) => ({
      id: b.id,
      title: b.title,
      format: b.format as "epub" | "pdf",
      authors: b.authors.map((a) => a.name),
      pageCount: b.pageCount,
      coverUrl: b.coverPath ? `/api/covers/${b.id}` : null,
    })),
  });
});
