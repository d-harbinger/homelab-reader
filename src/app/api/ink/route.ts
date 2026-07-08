import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { parseJson, withUser } from "@/lib/route-helpers";
import {
  HIGHLIGHTER_OPACITY,
  isColorForKind,
  isInkKind,
  isInkOpacity,
  isWidthForKind,
  parseInkPoints,
  type InkKind,
} from "@/lib/ink";

interface InkPayload {
  bookId?: string;
  page?: number;
  points?: unknown;
  color?: string;
  width?: number;
  opacity?: number;
  kind?: string;
}

type InkRow = {
  id: string;
  page: number;
  color: string;
  width: number;
  opacity: number;
  kind: string;
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
    kind: row.kind,
    points,
  };
}

// POST /api/ink — create a freehand ink stroke on a book page.
// Body: { bookId, page, points: [[x,y,pressure],...], color?, width? }
export const POST = withUser(async (user, req) => {
  const parsed = await parseJson<InkPayload>(req);
  if (!parsed.ok) return parsed.res;

  const { bookId, page, points, color, width, opacity, kind } = parsed.body;
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
  if (kind !== undefined && !isInkKind(kind)) {
    return NextResponse.json({ error: "invalid kind" }, { status: 400 });
  }
  const strokeKind: InkKind = isInkKind(kind) ? kind : "pen";
  // Color and width are validated against the instrument, so a highlighter
  // can't be saved with a pen swatch/nib or vice-versa.
  if (color !== undefined && !isColorForKind(strokeKind, color)) {
    return NextResponse.json({ error: "invalid color" }, { status: 400 });
  }
  if (width !== undefined && !isWidthForKind(strokeKind, width)) {
    return NextResponse.json({ error: "invalid width" }, { status: 400 });
  }
  // The highlighter has one fixed translucency (multiply does the see-through);
  // only the pen carries a client-chosen opacity.
  if (strokeKind === "pen" && opacity !== undefined && !isInkOpacity(opacity)) {
    return NextResponse.json({ error: "invalid opacity" }, { status: 400 });
  }

  const book = await prisma.book.findUnique({ where: { id: bookId } });
  if (!book) return NextResponse.json({ error: "unknown book" }, { status: 404 });

  const isHl = strokeKind === "highlighter";
  const row = await prisma.inkStroke.create({
    data: {
      bookId,
      userId: user.id,
      page,
      path: JSON.stringify({ points: pts }),
      color: color ?? (isHl ? "#fbbf24" : "#1c1c1e"),
      width: width ?? (isHl ? 24 : 4),
      opacity: isHl ? HIGHLIGHTER_OPACITY : (opacity ?? 1),
      kind: strokeKind,
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
