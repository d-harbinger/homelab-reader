import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authError, getCurrentUserId } from "@/lib/current-user";

interface HighlightPayload {
  bookId?: string;
  anchor?: { type: string; cfi?: string; page?: number; rects?: unknown };
  text?: string;
  color?: string;
}

const VALID_COLORS = new Set(["yellow", "green", "blue", "pink"]);

// POST /api/highlights — create a highlight on a book.
// Body: { bookId, anchor: { type: "epub-cfi-range", cfi } | { type: "pdf-rect", page, rects },
//         text, color }
export async function POST(req: Request) {
  let body: HighlightPayload;
  try {
    body = (await req.json()) as HighlightPayload;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const { bookId, anchor, text, color } = body;
  if (!bookId || !anchor || !text) {
    return NextResponse.json(
      { error: "missing bookId, anchor, or text" },
      { status: 400 },
    );
  }

  const book = await prisma.book.findUnique({ where: { id: bookId } });
  if (!book) return NextResponse.json({ error: "unknown book" }, { status: 404 });

  const safeColor = color && VALID_COLORS.has(color) ? color : "yellow";
  let userId: string;
  try {
    userId = await getCurrentUserId();
  } catch (e) {
    return authError(e);
  }

  const row = await prisma.highlight.create({
    data: {
      bookId,
      userId,
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
}

// GET /api/highlights?bookId=... — list highlights for a book.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const bookId = url.searchParams.get("bookId");
  if (!bookId) {
    return NextResponse.json({ error: "missing bookId" }, { status: 400 });
  }

  let userId: string;
  try {
    userId = await getCurrentUserId();
  } catch (e) {
    return authError(e);
  }
  const rows = await prisma.highlight.findMany({
    where: { bookId, userId },
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
}

function safeParseAnchor(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}
