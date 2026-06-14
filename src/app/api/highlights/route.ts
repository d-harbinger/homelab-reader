import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { parseJson, withUser } from "@/lib/route-helpers";
import { isHighlightColor } from "@/lib/highlight-colors";

interface HighlightPayload {
  bookId?: string;
  anchor?: { type: string; cfi?: string; page?: number; rects?: unknown };
  text?: string;
  color?: string;
}

// POST /api/highlights — create a highlight on a book.
// Body: { bookId, anchor: { type: "epub-cfi-range", cfi } | { type: "pdf-rect", page, rects },
//         text, color }
export const POST = withUser(async (user, req) => {
  const parsed = await parseJson<HighlightPayload>(req);
  if (!parsed.ok) return parsed.res;

  const { bookId, anchor, text, color } = parsed.body;
  if (!bookId || !anchor || !text) {
    return NextResponse.json(
      { error: "missing bookId, anchor, or text" },
      { status: 400 },
    );
  }

  // A supplied color must be a real palette color; reject unknown values rather
  // than silently coercing them. No color supplied → default to yellow.
  if (color !== undefined && !isHighlightColor(color)) {
    return NextResponse.json({ error: "invalid color" }, { status: 400 });
  }

  const book = await prisma.book.findUnique({ where: { id: bookId } });
  if (!book) return NextResponse.json({ error: "unknown book" }, { status: 404 });

  const safeColor = color ?? "yellow";

  const row = await prisma.highlight.create({
    data: {
      bookId,
      userId: user.id,
      anchor: JSON.stringify(anchor),
      text: text.slice(0, 8000),
      color: safeColor,
    },
  });

  return NextResponse.json({
    id: row.id,
    color: row.color,
    text: row.text,
    anchor: JSON.parse(row.anchor),
    createdAt: row.createdAt,
  });
});

// GET /api/highlights?bookId=... — list highlights for a book.
export const GET = withUser(async (user, req) => {
  const url = new URL(req.url);
  const bookId = url.searchParams.get("bookId");
  if (!bookId) {
    return NextResponse.json({ error: "missing bookId" }, { status: 400 });
  }

  const rows = await prisma.highlight.findMany({
    where: { bookId, userId: user.id },
    orderBy: { createdAt: "asc" },
  });

  return NextResponse.json({
    highlights: rows.map((h) => ({
      id: h.id,
      color: h.color,
      text: h.text,
      anchor: safeParseAnchor(h.anchor),
      createdAt: h.createdAt,
    })),
  });
});

function safeParseAnchor(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}
