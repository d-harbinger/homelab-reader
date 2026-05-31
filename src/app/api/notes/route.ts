import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authError, getCurrentUserId } from "@/lib/current-user";

interface NotePayload {
  bookId?: string;
  anchor?: { type: string; cfi?: string; page?: number };
  body?: string;
  context?: string | null;
}

// POST /api/notes — create a note attached to a CFI/page anchor.
// Body: { bookId, anchor, body, context? }
export async function POST(req: Request) {
  let body: NotePayload;
  try {
    body = (await req.json()) as NotePayload;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const { bookId, anchor, body: text, context } = body;
  if (!bookId || !anchor || typeof text !== "string") {
    return NextResponse.json(
      { error: "missing bookId, anchor, or body" },
      { status: 400 },
    );
  }

  const book = await prisma.book.findUnique({ where: { id: bookId } });
  if (!book) return NextResponse.json({ error: "unknown book" }, { status: 404 });

  let userId: string;
  try {
    userId = await getCurrentUserId();
  } catch (e) {
    return authError(e);
  }
  const row = await prisma.note.create({
    data: {
      bookId,
      userId,
      anchor: JSON.stringify(anchor),
      body: text.slice(0, 16000),
      context: context ? context.slice(0, 1000) : null,
    },
  });

  return NextResponse.json({
    id: row.id,
    body: row.body,
    anchor: JSON.parse(row.anchor),
    context: row.context,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}

// GET /api/notes?bookId=... — list notes for a book.
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
  const rows = await prisma.note.findMany({
    where: { bookId, userId },
    orderBy: { createdAt: "asc" },
  });

  return NextResponse.json({
    notes: rows.map((n) => ({
      id: n.id,
      body: n.body,
      anchor: safeParse(n.anchor),
      context: n.context,
      createdAt: n.createdAt,
      updatedAt: n.updatedAt,
    })),
  });
}

function safeParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}
