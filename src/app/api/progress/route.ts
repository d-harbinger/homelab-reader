import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { parseJson, withUser } from "@/lib/route-helpers";

interface ProgressPayload {
  bookId?: string;
  anchor?: { type: string; cfi?: string; page?: number };
  percent?: number;
}

// POST /api/progress — upsert reading progress for a book.
// Body: { bookId, anchor: { type: "epub-cfi", cfi } | { type: "pdf-page", page }, percent?: 0..1 }
export const POST = withUser(async (user, req) => {
  const parsed = await parseJson<ProgressPayload>(req);
  if (!parsed.ok) return parsed.res;

  const { bookId, anchor, percent } = parsed.body;
  if (!bookId || !anchor || typeof anchor !== "object") {
    return NextResponse.json({ error: "missing bookId or anchor" }, { status: 400 });
  }

  // Make sure the book actually exists; otherwise we'd silently store
  // dangling progress for a book the scanner removed.
  const book = await prisma.book.findUnique({ where: { id: bookId } });
  if (!book) return NextResponse.json({ error: "unknown book" }, { status: 404 });

  const anchorJson = JSON.stringify(anchor);
  const clampedPercent =
    typeof percent === "number" && isFinite(percent)
      ? Math.max(0, Math.min(1, percent))
      : 0;

  const row = await prisma.progress.upsert({
    where: { bookId_userId: { bookId, userId: user.id } },
    create: {
      bookId,
      userId: user.id,
      anchor: anchorJson,
      percent: clampedPercent,
    },
    update: {
      anchor: anchorJson,
      percent: clampedPercent,
    },
  });

  return NextResponse.json({
    bookId: row.bookId,
    percent: row.percent,
    updatedAt: row.updatedAt,
  });
});

// GET /api/progress?bookId=... — fetch current progress for a book.
export const GET = withUser(async (user, req) => {
  const url = new URL(req.url);
  const bookId = url.searchParams.get("bookId");
  if (!bookId) {
    return NextResponse.json({ error: "missing bookId" }, { status: 400 });
  }

  const row = await prisma.progress.findUnique({
    where: { bookId_userId: { bookId, userId: user.id } },
  });

  if (!row) {
    return NextResponse.json({ percent: 0, anchor: null });
  }

  let anchor: unknown = null;
  if (row.anchor) {
    try {
      anchor = JSON.parse(row.anchor);
    } catch {
      // ignore — anchor was malformed somehow; treat as start
    }
  }

  return NextResponse.json({
    percent: row.percent,
    anchor,
    updatedAt: row.updatedAt,
  });
});
