import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { parseJson } from "@/lib/parse-json";
import {
  isHighlightColor,
  type ColorKeyMap,
} from "@/lib/highlight-colors";

// Shared handler bodies for the per-book highlight color key — the legend that
// gives each highlight color a meaning in one book ("yellow = key terms").
// Same seam pattern as annotations/highlights.ts: validation, ownership, and
// response shapes live here once; the cookie-session route under
// src/app/api/highlight-key is a thin front door. Nothing here imports the
// auth seam, so an OPDS front door could be added later without touching this.

// Labels are short legend entries, not prose. Bounding them here keeps the
// stored rows and every surface that renders them (tooltips, panel legend,
// flashcard tags) predictable.
export const MAX_KEY_LABEL_LENGTH = 60;

// DB rows → the wire/consumer shape. Exported for the flashcard export route,
// which reads the same rows to tag cards by category.
export function toColorKeyMap(
  rows: { color: string; label: string }[],
): ColorKeyMap {
  const map: ColorKeyMap = {};
  for (const r of rows) {
    if (isHighlightColor(r.color)) map[r.color] = r.label;
  }
  return map;
}

// List the requesting user's color key for a book, as a color→label map.
export async function getColorKey(
  userId: string,
  req: Request,
): Promise<Response> {
  const url = new URL(req.url);
  const bookId = url.searchParams.get("bookId");
  if (!bookId) {
    return NextResponse.json({ error: "missing bookId" }, { status: 400 });
  }
  const rows = await prisma.highlightKeyEntry.findMany({
    where: { bookId, userId },
  });
  return NextResponse.json({ key: toColorKeyMap(rows) });
}

// Set one color's label. A non-empty label upserts the entry; an empty (or
// whitespace) label removes it, so "clear the field" in the editor is the
// delete gesture and no tombstone rows accumulate. Responds with the full
// updated map so callers can swap their cached key in one step.
export async function putColorKeyEntry(
  userId: string,
  req: Request,
): Promise<Response> {
  const parsed = await parseJson<{
    bookId?: string;
    color?: string;
    label?: string;
  }>(req);
  if (!parsed.ok) return parsed.res;

  const { bookId, color, label } = parsed.body;
  if (!bookId || color === undefined) {
    return NextResponse.json(
      { error: "missing bookId or color" },
      { status: 400 },
    );
  }
  if (!isHighlightColor(color)) {
    return NextResponse.json({ error: "invalid color" }, { status: 400 });
  }
  if (label !== undefined && typeof label !== "string") {
    return NextResponse.json({ error: "invalid label" }, { status: 400 });
  }

  const book = await prisma.book.findUnique({ where: { id: bookId } });
  if (!book) {
    return NextResponse.json({ error: "unknown book" }, { status: 404 });
  }

  const trimmed = (label ?? "").trim().slice(0, MAX_KEY_LABEL_LENGTH);
  if (trimmed) {
    await prisma.highlightKeyEntry.upsert({
      where: { bookId_userId_color: { bookId, userId, color } },
      create: { bookId, userId, color, label: trimmed },
      update: { label: trimmed },
    });
  } else {
    // deleteMany instead of delete: clearing an entry that never existed is a
    // no-op, not an error.
    await prisma.highlightKeyEntry.deleteMany({
      where: { bookId, userId, color },
    });
  }

  const rows = await prisma.highlightKeyEntry.findMany({
    where: { bookId, userId },
  });
  return NextResponse.json({ key: toColorKeyMap(rows) });
}
