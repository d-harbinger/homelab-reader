import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withUser } from "@/lib/route-helpers";
import { groupDuplicates } from "@/lib/library/duplicates";

// GET /api/books/duplicates — read-only report of probable same-work
// duplicates (ISBN, then normalized title+author). Never mutates the library.
// No file-path field is selected or forwarded, so no scan-root string leaks.
export const GET = withUser(async () => {
  const books = await prisma.book.findMany({
    orderBy: { addedAt: "asc" },
    include: { authors: true },
  });
  const groups = groupDuplicates(
    books.map((b) => ({
      id: b.id,
      title: b.title,
      format: b.format,
      isbn: b.isbn,
      authors: b.authors.map((a) => a.name),
      coverUrl: b.coverPath ? `/api/covers/${b.id}` : null,
    })),
  );
  return NextResponse.json({ groups });
});
