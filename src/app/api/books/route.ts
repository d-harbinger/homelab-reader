import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// GET /api/books — flat list, newest first. Pagination is a later phase.
export async function GET() {
  const books = await prisma.book.findMany({
    orderBy: { addedAt: "desc" },
    take: 200,
    include: { authors: true },
  });

  return NextResponse.json({
    books: books.map((b) => ({
      id: b.id,
      title: b.title,
      format: b.format,
      authors: b.authors.map((a) => a.name),
      language: b.language ?? null,
      pageCount: b.pageCount ?? null,
      fileSizeBytes: b.fileSizeBytes ?? null,
      coverUrl: b.coverPath ? `/api/covers/${b.id}` : null,
      addedAt: b.addedAt,
    })),
  });
}
