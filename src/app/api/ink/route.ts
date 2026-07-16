import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { parseJson, withUser } from "@/lib/route-helpers";
import {
  HIGHLIGHTER_OPACITY,
  isColorForKind,
  isInkKind,
  isInkOpacity,
  isWidthForKind,
  parseInkAnchor,
  parseInkPoints,
  type InkAnchor,
  type InkKind,
} from "@/lib/ink";

interface InkPayload {
  bookId?: string;
  page?: number;
  anchor?: unknown;
  points?: unknown;
  color?: string;
  width?: number;
  opacity?: number;
  kind?: string;
}

type InkRow = {
  id: string;
  page: number | null;
  anchor: string | null;
  color: string;
  width: number;
  opacity: number;
  kind: string;
  path: string;
};

// Re-validate the stored column on the way out rather than trusting it: a row
// written by an older or broken client can't emit a shape the reader would
// choke on. Same posture as the points parse below — degrade, never throw.
function readAnchorColumn(raw: string | null): InkAnchor | null {
  if (raw === null) return null;
  try {
    return parseInkAnchor(JSON.parse(raw));
  } catch {
    return null;
  }
}

function serialize(row: InkRow) {
  let points: number[][] = [];
  try {
    const parsed = JSON.parse(row.path) as { points?: number[][] };
    points = parsed.points ?? [];
  } catch {
    points = [];
  }
  const out: {
    id: string;
    page: number | null;
    color: string;
    width: number;
    opacity: number;
    kind: string;
    points: number[][];
    anchor?: InkAnchor;
  } = {
    id: row.id,
    page: row.page,
    color: row.color,
    width: row.width,
    opacity: row.opacity,
    kind: row.kind,
    points,
  };
  // A PDF stroke has no anchor, and the key stays ABSENT rather than null so
  // its payload is byte-for-byte what the PDF reader has always received.
  const anchor = readAnchorColumn(row.anchor);
  if (anchor) out.anchor = anchor;
  return out;
}

// POST /api/ink — create a freehand ink stroke on a book.
// Body: { bookId, points: [[x,y,pressure],...], color?, width? } plus EXACTLY
// one of:
//   page   — a PDF stroke, fastened to a 1-based page number
//   anchor — an EPUB stroke, fastened to the CFI of the block drawn on
export const POST = withUser(async (user, req) => {
  const parsed = await parseJson<InkPayload>(req);
  if (!parsed.ok) return parsed.res;

  const { bookId, page, anchor, points, color, width, opacity, kind } = parsed.body;
  // Exactly one way to fasten a stroke. Both is contradictory, neither leaves a
  // stroke floating — either way there is no row worth writing.
  if (!bookId || (page === undefined) === (anchor === undefined)) {
    return NextResponse.json(
      { error: "missing bookId, or not exactly one of page and anchor" },
      { status: 400 },
    );
  }

  let pageValue: number | null = null;
  let anchorJson: string | null = null;
  if (page !== undefined) {
    if (typeof page !== "number" || !Number.isInteger(page) || page < 1) {
      return NextResponse.json({ error: "invalid page" }, { status: 400 });
    }
    pageValue = page;
  } else {
    const parsedAnchor = parseInkAnchor(anchor);
    // A page-kind anchor is rejected here on purpose: `page` is the one way to
    // say "page". Taking it through this field too would write a row with a
    // null page that no PDF page query can match — a stroke that saves and then
    // never renders.
    if (!parsedAnchor || parsedAnchor.kind !== "block") {
      return NextResponse.json({ error: "invalid anchor" }, { status: 400 });
    }
    anchorJson = JSON.stringify(parsedAnchor);
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
      page: pageValue,
      anchor: anchorJson,
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
