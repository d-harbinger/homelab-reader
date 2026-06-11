import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  getCurrentUser,
  authError,
  UnauthenticatedError,
} from "@/lib/current-user";
import { exportAnnotationsMarkdown } from "@/lib/notes/markdown-export";

// GET /api/books/[id]/annotations — the signed-in user's highlights + notes for
// one book as a portable Markdown document (Content-Disposition: attachment).
// Per-user: only the requesting user's annotations are exported.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await getCurrentUser();
    if (!user) return authError(new UnauthenticatedError());
    const { id } = await params;

    const book = await prisma.book.findUnique({
      where: { id },
      include: { authors: true },
    });
    if (!book) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const [highlights, notes] = await Promise.all([
      prisma.highlight.findMany({ where: { bookId: id, userId: user.id } }),
      prisma.note.findMany({ where: { bookId: id, userId: user.id } }),
    ]);

    const markdown = exportAnnotationsMarkdown({
      book: {
        title: book.title,
        authors: book.authors,
        isbn: book.isbn,
        format: book.format,
      },
      highlights,
      notes,
    });

    const slug =
      book.title.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "") || "book";
    return new NextResponse(markdown, {
      headers: {
        "Content-Type": "text/markdown; charset=utf-8",
        "Content-Disposition": `attachment; filename="${slug}-annotations.md"`,
      },
    });
  } catch (e) {
    return authError(e);
  }
}
