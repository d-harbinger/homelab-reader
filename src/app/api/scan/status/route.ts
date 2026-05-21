import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { watcherStatus } from "@/lib/scanner/watcher";

export async function GET() {
  const [bookCount, lastBook] = await Promise.all([
    prisma.book.count(),
    prisma.book.findFirst({ orderBy: { scannedAt: "desc" } }),
  ]);

  return NextResponse.json({
    ...watcherStatus(),
    bookCount,
    lastScannedAt: lastBook?.scannedAt ?? null,
  });
}
