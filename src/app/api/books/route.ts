import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

// GET /api/books — flat list, newest first by default.
//
// Optional query params turn this into the search/browse backend:
//   q       free-text match on title, subtitle, or author name
//   format  "epub" | "pdf"
//   tag      exact tag name
//   sort     "recent" (default) | "title"
//
// With no params the response is identical to the original flat list, so
// the home view keeps working unchanged.
//
// Note: SQLite's LIKE (what Prisma `contains` compiles to) is already
// case-insensitive for ASCII, so we don't pass `mode: "insensitive"` —
// that modifier is unsupported on SQLite and would throw.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const q = url.searchParams.get("q")?.trim() ?? "";
  const format = url.searchParams.get("format")?.trim() ?? "";
  const tag = url.searchParams.get("tag")?.trim() ?? "";
  const sort = url.searchParams.get("sort") === "title" ? "title" : "recent";

  const where: Prisma.BookWhereInput = {};
  if (q) {
    where.OR = [
      { title: { contains: q } },
      { subtitle: { contains: q } },
      { authors: { some: { name: { contains: q } } } },
    ];
  }
  if (format === "epub" || format === "pdf") where.format = format;
  if (tag) where.tags = { some: { name: tag } };

  const books = await prisma.book.findMany({
    where,
    orderBy: sort === "title" ? { title: "asc" } : { addedAt: "desc" },
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
