import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// GET /api/progress/recent — books with active reading progress, newest
// first. Drives the "Continue reading" row. Returns an empty list while
// the reader phase isn't shipped or no progress has been recorded.
export async function GET() {
  const rows = await prisma.progress.findMany({
    where: { percent: { gt: 0 } },
    orderBy: { updatedAt: "desc" },
    take: 12,
    include: { book: { include: { authors: true } } },
  });

  return NextResponse.json({
    books: rows.map((p) => ({
      id: p.book.id,
      title: p.book.title,
      format: p.book.format,
      authors: p.book.authors.map((a) => a.name),
      pageCount: p.book.pageCount,
      coverUrl: p.book.coverPath ? `/api/covers/${p.book.id}` : null,
      percent: p.percent,
    })),
  });
}
