import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

const LIMIT = 18;

// GET /api/books/recent — newest additions, for the home "Recently
// Added" shelf. Mirrors the BookCard shape /api/books returns so the
// home view can drop them straight in.
export async function GET() {
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
}
