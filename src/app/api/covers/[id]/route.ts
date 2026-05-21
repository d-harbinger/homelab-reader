import { NextResponse } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";
import { prisma } from "@/lib/prisma";
import { resolveCoverPath } from "@/lib/scanner/covers";

const MIME: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
};

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const book = await prisma.book.findUnique({ where: { id } });
  if (!book?.coverPath) {
    return new NextResponse(null, { status: 404 });
  }

  let full: string;
  try {
    full = resolveCoverPath(book.coverPath);
  } catch {
    return new NextResponse(null, { status: 400 });
  }

  let bytes: Buffer;
  try {
    bytes = await fs.readFile(full);
  } catch {
    return new NextResponse(null, { status: 404 });
  }

  const ext = path.extname(full).slice(1).toLowerCase();
  const mime = MIME[ext] ?? "application/octet-stream";

  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "Content-Type": mime,
      "Cache-Control": "public, max-age=86400",
    },
  });
}
