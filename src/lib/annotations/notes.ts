import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { parseJson } from "@/lib/parse-json";

// Shared note-handler bodies (S2). Same split as highlights.ts: one validation
// and ownership surface, called by both the cookie-session routes under
// src/app/api/notes/** and the OPDS-token routes under src/app/api/opds/notes/**.
// This module imports no auth seam so the OPDS routes stay next-auth-free.

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

// Create a note attached to a CFI/page anchor, attributed to userId.
// Body: { bookId, anchor, body, context?, highlightId? }
export async function createNote(
  userId: string,
  req: Request,
): Promise<Response> {
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
      where: { id: highlightId, userId },
    });
    if (!highlight) {
      return NextResponse.json({ error: "unknown highlight" }, { status: 404 });
    }
  }

  const row = await prisma.note.create({
    data: {
      bookId,
      userId,
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
}

// List notes for a book, scoped to userId. bookId comes from the query string.
export async function listNotes(
  userId: string,
  req: Request,
): Promise<Response> {
  const url = new URL(req.url);
  const bookId = url.searchParams.get("bookId");
  if (!bookId) {
    return NextResponse.json({ error: "missing bookId" }, { status: 400 });
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
      highlightId: n.highlightId,
      createdAt: n.createdAt,
      updatedAt: n.updatedAt,
    })),
  });
}

// Update a note's body. Ownership mismatch and non-existence both yield 404.
export async function patchNote(
  userId: string,
  id: string,
  req: Request,
): Promise<Response> {
  const parsed = await parseJson<{ body?: string }>(req);
  if (!parsed.ok) return parsed.res;
  if (typeof parsed.body.body !== "string") {
    return NextResponse.json({ error: "missing body" }, { status: 400 });
  }

  const existing = await prisma.note.findUnique({ where: { id } });
  if (!existing || existing.userId !== userId) {
    return new NextResponse(null, { status: 404 });
  }

  const row = await prisma.note.update({
    where: { id },
    data: { body: parsed.body.body.slice(0, 16000) },
  });
  return NextResponse.json({
    id: row.id,
    body: row.body,
    updatedAt: row.updatedAt,
  });
}

// Remove a note. Ownership mismatch and non-existence both yield 404.
export async function deleteNote(
  userId: string,
  id: string,
): Promise<Response> {
  const existing = await prisma.note.findUnique({ where: { id } });
  if (!existing || existing.userId !== userId) {
    return new NextResponse(null, { status: 404 });
  }
  await prisma.note.delete({ where: { id } });
  return new NextResponse(null, { status: 204 });
}

function safeParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}
