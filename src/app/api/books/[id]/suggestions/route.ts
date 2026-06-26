import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withUser, type IdContext } from "@/lib/route-helpers";

// GET /api/books/[id]/suggestions — the pending OpenLibrary metadata suggestions
// stored against one book (D3 enrich-on-import), ranked best-confidence-first for
// the review screen. Session-gated, mirroring the sibling citation/annotations
// routes: the library is shared (suggestions are book-scoped, not user-scoped),
// so any signed-in user may read them; signed-out callers get 401 via withUser.
//
// The persisted columns store authors/subjects as JSON strings (SQLite has no
// array type); we parse them back to arrays for the client, defensively falling
// back to [] on any malformed value rather than throwing.
export const GET = withUser<IdContext>(async (_user, _req, { params }) => {
  const { id } = await params;

  const book = await prisma.book.findUnique({ where: { id } });
  if (!book) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const rows = await prisma.bookSuggestion.findMany({
    where: { bookId: id, status: "pending" },
    orderBy: { confidence: "desc" },
  });

  return NextResponse.json({
    suggestions: rows.map((s) => ({
      id: s.id,
      source: s.source,
      confidence: s.confidence,
      title: s.title,
      authors: safeParseArray(s.authors),
      publishedYear: s.publishedYear,
      publisher: s.publisher,
      isbn: s.isbn,
      subjects: safeParseArray(s.subjects),
      coverUrl: s.coverUrl,
      workKey: s.workKey,
      status: s.status,
      createdAt: s.createdAt,
    })),
  });
});

function safeParseArray(s: string): string[] {
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}
