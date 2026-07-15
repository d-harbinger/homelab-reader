import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { parseJson } from "@/lib/parse-json";
import { isHighlightColor } from "@/lib/highlight-colors";
import {
  isTextQuoteAnchor,
  parseTextQuoteAnchor,
  serializeAnchorBounded,
  type AnnotationEnvelope,
} from "@/lib/annotations/envelope";

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
  anchor?: unknown;
  text?: string;
  color?: string;
}

// Create a highlight on a book, attributed to userId.
// Body: { bookId, anchor, text, color } where anchor is one of:
//   { type: "epub-cfi-range", cfi, prefix?, suffix?, progression? }  (web reader)
//   { type: "pdf-rect", page, rects }                                (web reader, PDF)
//   { type: "text-quote", quote, prefix?, suffix?, chapterHref?, progression? }
//       — an anchor synced from another device, validated against the envelope
//         bounds here (Phase C P1). Other shapes pass through unvalidated as
//         before; only the text-quote envelope is a wire contract we own.
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

  // A text-quote anchor is a wire contract we own — validate and normalize it
  // (clamp progression, drop empty optional keys). Every other anchor shape is
  // stored verbatim, exactly as before.
  let anchorToStore: unknown = anchor;
  if (isTextQuoteAnchor(anchor)) {
    const parsedAnchor = parseTextQuoteAnchor(anchor);
    if (!parsedAnchor.ok) {
      return NextResponse.json({ error: parsedAnchor.error }, { status: 400 });
    }
    anchorToStore = parsedAnchor.envelope;
  }

  const book = await prisma.book.findUnique({ where: { id: bookId } });
  if (!book) return NextResponse.json({ error: "unknown book" }, { status: 404 });

  const safeColor = color ?? "yellow";

  // Bound the serialized anchor for every shape. The text-quote envelope is
  // already field-bounded above; this catches pdf-rect / epub-cfi-range / any
  // other shape so a device can't write an unbounded blob.
  const serialized = serializeAnchorBounded(anchorToStore);
  if (!serialized.ok) {
    return NextResponse.json({ error: serialized.error }, { status: 400 });
  }

  const row = await prisma.highlight.create({
    data: {
      bookId,
      userId,
      anchor: serialized.json,
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

// Change a highlight's color and/or perform the one-time text-quote → CFI
// anchor upgrade. A non-existent id and another user's id collapse to the same
// 404 so existence is never leaked across users.
//
// The optional `anchor` field is the Phase C P1 upgrade: once the web reader
// resolves a synced text-quote anchor to an EPUB CFI, it PATCHes
// { anchor: { type: "epub-cfi-range", cfi } } so resolution happens once. The
// upgrade is allowed ONLY when the stored anchor is still a text-quote envelope;
// the resolved CFI is merged OVER the preserved quote/prefix/suffix/progression.
// Any anchor PATCH against a non-text-quote anchor is a 400.
export async function patchHighlight(
  userId: string,
  id: string,
  req: Request,
): Promise<Response> {
  const parsed = await parseJson<{ color?: string; anchor?: unknown }>(req);
  if (!parsed.ok) return parsed.res;

  const existing = await prisma.highlight.findUnique({ where: { id } });
  if (!existing || existing.userId !== userId) {
    return new NextResponse(null, { status: 404 });
  }

  const color = isHighlightColor(parsed.body.color)
    ? parsed.body.color
    : existing.color;

  // Anchor upgrade path (only present when the client is resolving a text-quote
  // anchor). Absent → the color-only behavior below is unchanged.
  if (parsed.body.anchor !== undefined) {
    const stored = safeParseAnchor(existing.anchor);
    const storedEnvelope = parseTextQuoteAnchor(stored);
    if (!storedEnvelope.ok) {
      return NextResponse.json(
        { error: "anchor upgrade allowed only for text-quote anchors" },
        { status: 400 },
      );
    }
    const cfi = readUpgradeCfi(parsed.body.anchor);
    if (cfi === null) {
      return NextResponse.json(
        { error: "anchor upgrade requires { type: 'epub-cfi-range', cfi }" },
        { status: 400 },
      );
    }
    const upgraded = mergeCfiOverEnvelope(cfi, storedEnvelope.envelope);
    const serialized = serializeAnchorBounded(upgraded);
    if (!serialized.ok) {
      return NextResponse.json({ error: serialized.error }, { status: 400 });
    }
    const row = await prisma.highlight.update({
      where: { id },
      data: { color, anchor: serialized.json },
    });
    return NextResponse.json({
      id: row.id,
      color: row.color,
      anchor: JSON.parse(row.anchor),
    });
  }

  const row = await prisma.highlight.update({
    where: { id },
    data: { color },
  });
  return NextResponse.json({ id: row.id, color: row.color });
}

// The resolved-CFI upgrade anchor shape: { type: "epub-cfi-range", cfi }.
// Returns the cfi when the shape is valid, or null to signal a 400.
function readUpgradeCfi(a: unknown): string | null {
  if (typeof a !== "object" || a === null) return null;
  const { type, cfi } = a as { type?: unknown; cfi?: unknown };
  if (type !== "epub-cfi-range") return null;
  if (typeof cfi !== "string" || cfi.length === 0) return null;
  return cfi;
}

// Merge the resolved CFI over the text-quote envelope's preserved fields. The
// result is the extended epub-cfi-range shape the web reader already writes
// (quote context retained so the anchor could be re-resolved if the CFI drifts).
function mergeCfiOverEnvelope(
  cfi: string,
  envelope: AnnotationEnvelope,
): Record<string, unknown> {
  const upgraded: Record<string, unknown> = {
    type: "epub-cfi-range",
    cfi,
    quote: envelope.quote,
  };
  if (envelope.prefix !== undefined) upgraded.prefix = envelope.prefix;
  if (envelope.suffix !== undefined) upgraded.suffix = envelope.suffix;
  if (envelope.progression !== undefined) upgraded.progression = envelope.progression;
  return upgraded;
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
