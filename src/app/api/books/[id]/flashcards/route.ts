import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withUser, type IdContext } from "@/lib/route-helpers";
import { toColorKeyMap } from "@/lib/annotations/color-key";
import { exportFlashcards } from "@/lib/notes/flashcard-export";

// GET /api/books/[id]/flashcards — the signed-in user's highlights for one
// book as an Anki-importable text file (Content-Disposition: attachment).
// Cards carry the note attached to each highlight and are tagged by the
// book's color key. Per-user, like the Markdown annotations export.
export const GET = withUser<IdContext>(async (user, _req, { params }) => {
  const { id } = await params;

  const book = await prisma.book.findUnique({ where: { id } });
  if (!book) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const [highlights, notes, keyRows] = await Promise.all([
    prisma.highlight.findMany({ where: { bookId: id, userId: user.id } }),
    prisma.note.findMany({ where: { bookId: id, userId: user.id } }),
    prisma.highlightKeyEntry.findMany({
      where: { bookId: id, userId: user.id },
    }),
  ]);

  const text = exportFlashcards({
    book: { title: book.title },
    highlights,
    notes,
    colorKey: toColorKeyMap(keyRows),
  });

  const slug =
    book.title.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "") || "book";
  return new NextResponse(text, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Content-Disposition": `attachment; filename="${slug}-flashcards.txt"`,
    },
  });
});
