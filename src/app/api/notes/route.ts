import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { parseJson, withUser } from "@/lib/route-helpers";

interface NotePayload {
  bookId?: string;
  anchor?: { type: string; cfi?: string; page?: number };
  body?: string;
  context?: string | null;
  // Optional FK (Slice 2b): the highlight this note annotates. When present it
  // must be an existing highlight owned by the caller; otherwise the request is
  // rejected (404, mirroring "unknown book") and no note is created.
  highlightId?: string | null;
}

// POST /api/notes — create a note attached to a CFI/page anchor.
// Body: { bookId, anchor, body, context?, highlightId? }
export const POST = withUser(async (user, req) => {
  const parsed = await parseJson<NotePayload>(req);
  if (!parsed.ok) return parsed.res;

  const { bookId, anchor, body: text, context, highlightId } = parsed.body;
  if (!bookId || !anchor || typeof text !== "string") {
    return NextResponse.json(
      { error: "missing bookId, anchor, or body" },
      { status: 400 },
    );
  }

  const book = await prisma.book.findUnique({ where: { id: bookId } });
  if (!book) return NextResponse.json({ error: "unknown book" }, { status: 404 });

  // Validate the optional highlight binding: it must exist AND belong to the
  // caller. A non-existent id and another user's id collapse to the same 404 so
  // existence is never leaked across users (same posture as the by-id routes).
  if (highlightId != null) {
    const highlight = await prisma.highlight.findFirst({
      where: { id: highlightId, userId: user.id },
    });
    if (!highlight) {
      return NextResponse.json({ error: "unknown highlight" }, { status: 404 });
    }
  }

  const row = await prisma.note.create({
    data: {
      bookId,
      userId: user.id,
      anchor: JSON.stringify(anchor),
      body: text.slice(0, 16000),
      context: context ? context.slice(0, 1000) : null,
      highlightId: highlightId ?? null,
    },
  });

  return NextResponse.json({
    id: row.id,
    body: row.body,
    anchor: JSON.parse(row.anchor),
    context: row.context,
    highlightId: row.highlightId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
});

// GET /api/notes?bookId=... — list notes for a book.
export const GET = withUser(async (user, req) => {
  const url = new URL(req.url);
  const bookId = url.searchParams.get("bookId");
  if (!bookId) {
    return NextResponse.json({ error: "missing bookId" }, { status: 400 });
  }

  const rows = await prisma.note.findMany({
    where: { bookId, userId: user.id },
    orderBy: { createdAt: "asc" },
  });

  return NextResponse.json({
    notes: rows.map((n) => ({
      id: n.id,
      body: n.body,
      anchor: safeParse(n.anchor),
      context: n.context,
      highlightId: n.highlightId,
      createdAt: n.createdAt,
      updatedAt: n.updatedAt,
    })),
  });
});

function safeParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}
