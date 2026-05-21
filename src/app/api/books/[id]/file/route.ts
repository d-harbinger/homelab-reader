import { NextResponse } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";
import { prisma } from "@/lib/prisma";

const MIME: Record<string, string> = {
  epub: "application/epub+zip",
  pdf: "application/pdf",
};

// GET /api/books/[id]/file — stream the source file bytes. Used by:
// - The browser's native PDF viewer (when a PDF book is "opened")
// - The EPUB reader, which fetches the bytes to feed epub.js
//
// Path-escape defended: we only serve files whose absolute path was
// recorded in the DB by the scanner; we don't accept user-supplied paths.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const book = await prisma.book.findUnique({ where: { id } });
  if (!book) return new NextResponse(null, { status: 404 });

  const filePath = path.resolve(book.filePath);
  let bytes: Buffer;
  try {
    bytes = await fs.readFile(filePath);
  } catch {
    return new NextResponse(null, { status: 404 });
  }

  const mime = MIME[book.format] ?? "application/octet-stream";
  const safeName = encodeURIComponent(
    `${book.title}.${book.format}`.replace(/[/\\]/g, "_"),
  );

  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "Content-Type": mime,
      // inline so PDFs render in the browser tab; EPUBs get the same
      // disposition (browser ignores it for fetch'd binary blobs)
      "Content-Disposition": `inline; filename*=UTF-8''${safeName}`,
      "Cache-Control": "private, max-age=3600",
    },
  });
}
