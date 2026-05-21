import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const book = await prisma.book.findUnique({
    where: { id },
    include: { authors: true, tags: true },
  });
  if (!book) return new NextResponse(null, { status: 404 });

  return NextResponse.json({
    id: book.id,
    title: book.title,
    subtitle: book.subtitle,
    format: book.format,
    authors: book.authors.map((a) => a.name),
    tags: book.tags.map((t) => t.name),
    language: book.language,
    publisher: book.publisher,
    publishedAt: book.publishedAt,
    description: book.description,
    isbn: book.isbn,
    pageCount: book.pageCount,
    fileSizeBytes: book.fileSizeBytes,
    coverUrl: book.coverPath ? `/api/covers/${book.id}` : null,
    addedAt: book.addedAt,
  });
}
