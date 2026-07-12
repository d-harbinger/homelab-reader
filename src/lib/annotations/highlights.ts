import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { parseJson } from "@/lib/parse-json";
import { isHighlightColor } from "@/lib/highlight-colors";

// Shared highlight-handler bodies (S2). The validation, ownership, and response
// shapes live here ONCE and are called by both auth front doors:
//   - the cookie-session routes under src/app/api/highlights/**
//   - the OPDS-token routes under src/app/api/opds/highlights/**
// Each front door resolves its own user first (withUser vs authenticateOpds),
// then hands the resolved user id to these functions. Nothing in this module
// imports the auth seam, so the OPDS routes stay free of next-auth exactly like
// /api/opds/progress does (see the note in src/lib/parse-json.ts).

interface HighlightPayload {
  bookId?: string;
  anchor?: { type: string; cfi?: string; page?: number; rects?: unknown };
  text?: string;
  color?: string;
}

// Create a highlight on a book, attributed to userId.
// Body: { bookId, anchor: { type: "epub-cfi-range", cfi } | { type: "pdf-rect", page, rects },
//         text, color }
export async function createHighlight(
  userId: string,
  req: Request,
): Promise<Response> {
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

// List highlights for a book, scoped to userId. bookId comes from the query string.
export async function listHighlights(
  userId: string,
  req: Request,
): Promise<Response> {
  const url = new URL(req.url);
  const bookId = url.searchParams.get("bookId");
  if (!bookId) {
    return NextResponse.json({ error: "missing bookId" }, { status: 400 });
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

// Change a highlight's color. A non-existent id and another user's id collapse
// to the same 404 so existence is never leaked across users.
export async function patchHighlight(
  userId: string,
  id: string,
  req: Request,
): Promise<Response> {
  const parsed = await parseJson<{ color?: string }>(req);
  if (!parsed.ok) return parsed.res;

  const existing = await prisma.highlight.findUnique({ where: { id } });
  if (!existing || existing.userId !== userId) {
    return new NextResponse(null, { status: 404 });
  }

  const color = isHighlightColor(parsed.body.color)
    ? parsed.body.color
    : existing.color;

  const row = await prisma.highlight.update({
    where: { id },
    data: { color },
  });
  return NextResponse.json({ id: row.id, color: row.color });
}

// Remove a highlight. Ownership mismatch and non-existence both yield 404.
export async function deleteHighlight(
  userId: string,
  id: string,
): Promise<Response> {
  const existing = await prisma.highlight.findUnique({ where: { id } });
  if (!existing || existing.userId !== userId) {
    return new NextResponse(null, { status: 404 });
  }
  await prisma.highlight.delete({ where: { id } });
  return new NextResponse(null, { status: 204 });
}

function safeParseAnchor(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}
