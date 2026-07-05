import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { parseJson, withUser } from "@/lib/route-helpers";
import { isInkColor, isInkOpacity, isInkWidth, parseInkPoints } from "@/lib/ink";

interface InkPayload {
  bookId?: string;
  page?: number;
  points?: unknown;
  color?: string;
  width?: number;
  opacity?: number;
}

type InkRow = {
  id: string;
  page: number;
  color: string;
  width: number;
  opacity: number;
  path: string;
};

function serialize(row: InkRow) {
  let points: number[][] = [];
  try {
    const parsed = JSON.parse(row.path) as { points?: number[][] };
    points = parsed.points ?? [];
  } catch {
    points = [];
  }
  return {
    id: row.id,
    page: row.page,
    color: row.color,
    width: row.width,
    opacity: row.opacity,
    points,
  };
}

// POST /api/ink — create a freehand ink stroke on a book page.
// Body: { bookId, page, points: [[x,y,pressure],...], color?, width? }
export const POST = withUser(async (user, req) => {
  const parsed = await parseJson<InkPayload>(req);
  if (!parsed.ok) return parsed.res;

  const { bookId, page, points, color, width, opacity } = parsed.body;
  if (!bookId || typeof page !== "number" || !Number.isInteger(page) || page < 1) {
    return NextResponse.json(
      { error: "missing bookId or valid page" },
      { status: 400 },
    );
  }
  const pts = parseInkPoints(points);
  if (!pts) {
    return NextResponse.json({ error: "invalid points" }, { status: 400 });
  }
  if (color !== undefined && !isInkColor(color)) {
    return NextResponse.json({ error: "invalid color" }, { status: 400 });
  }
  if (width !== undefined && !isInkWidth(width)) {
    return NextResponse.json({ error: "invalid width" }, { status: 400 });
  }
  if (opacity !== undefined && !isInkOpacity(opacity)) {
    return NextResponse.json({ error: "invalid opacity" }, { status: 400 });
  }

  const book = await prisma.book.findUnique({ where: { id: bookId } });
  if (!book) return NextResponse.json({ error: "unknown book" }, { status: 404 });

  const row = await prisma.inkStroke.create({
    data: {
      bookId,
      userId: user.id,
      page,
      path: JSON.stringify({ points: pts }),
      color: color ?? "#1c1c1e",
      width: width ?? 4,
      opacity: opacity ?? 1,
    },
  });
  return NextResponse.json(serialize(row));
});

// GET /api/ink?bookId=... — list the caller's ink strokes for a book.
export const GET = withUser(async (user, req) => {
  const url = new URL(req.url);
  const bookId = url.searchParams.get("bookId");
  if (!bookId) {
    return NextResponse.json({ error: "missing bookId" }, { status: 400 });
  }
  const rows = await prisma.inkStroke.findMany({
    where: { bookId, userId: user.id },
    orderBy: { createdAt: "asc" },
  });
  return NextResponse.json({ strokes: rows.map(serialize) });
});
