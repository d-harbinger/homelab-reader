import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withUser } from "@/lib/route-helpers";

// GET /api/progress/recent — books with active reading progress, newest
// first. Drives the "Continue reading" row. Returns an empty list while
// the reader phase isn't shipped or no progress has been recorded.
export const GET = withUser(async (user) => {
  // Any progress row counts as "in progress" — percent stays 0 until
  // epub.js generates the locations table, but the book still belongs
  // here once the user has opened it once. Scoped to the caller so the
  // "Continue reading" row never leaks another user's books.
  const rows = await prisma.progress.findMany({
    where: { userId: user.id, anchor: { not: null } },
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
});
