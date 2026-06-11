import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withUser, type IdContext } from "@/lib/route-helpers";
import { formatReference, formatBibtex } from "@/lib/metadata/citation";

// GET /api/books/[id]/citation — a ready-to-paste citation for one book, two
// ways: a casual one-line reference and a BibTeX @book entry. Session-gated;
// the client handles copy/download. The book's own metadata is the source —
// publishedYear is derived from publishedAt, authors come from the relation,
// and absent publisher/isbn are dropped (the formatters omit, never blank).
export const GET = withUser<IdContext>(async (_user, _req, { params }) => {
  const { id } = await params;

  const book = await prisma.book.findUnique({
    where: { id },
    include: { authors: true },
  });
  if (!book) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const citationInput = {
    title: book.title,
    authors: book.authors.map((a) => a.name),
    publishedYear: book.publishedAt?.getFullYear(),
    publisher: book.publisher ?? undefined,
    isbn: book.isbn ?? undefined,
  };

  return NextResponse.json({
    reference: formatReference(citationInput),
    bibtex: formatBibtex(citationInput),
  });
});
