import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticateOpds, opdsChallenge } from "@/lib/opds-auth";
import { parseJson } from "@/lib/parse-json";
import { serializeAnchorBounded } from "@/lib/annotations/envelope";

// POST /api/opds/progress — OPDS-context reading-progress write (OPDS-03).
//
// This is the dedicated progress path for OPDS clients (android-reader). It
// authenticates with the per-user OPDS token — NOT the cookie session — and
// attributes the upsert to that token's owner, so progress reported over the
// OPDS path always lands on the right account. The web reader's own
// /api/progress stays on the cookie session and is untouched.
//
// Body mirrors /api/progress exactly:
//   { bookId, anchor: { type: "epub-cfi", cfi } | { type: "pdf-page", page },
//     percent?: 0..1 }
interface ProgressPayload {
  bookId?: string;
  anchor?: { type: string; cfi?: string; page?: number };
  percent?: number;
}

export async function POST(req: Request) {
  // Authenticate with the OPDS token first; no valid token -> 401 challenge.
  const user = await authenticateOpds(req);
  if (!user) return opdsChallenge();

  const parsed = await parseJson<ProgressPayload>(req);
  if (!parsed.ok) return parsed.res;

  const { bookId, anchor, percent } = parsed.body;
  if (!bookId || !anchor || typeof anchor !== "object") {
    return NextResponse.json(
      { error: "missing bookId or anchor" },
      { status: 400 },
    );
  }

  // Make sure the book actually exists; otherwise we'd silently store dangling
  // progress for a book the scanner removed.
  const book = await prisma.book.findUnique({ where: { id: bookId } });
  if (!book) return NextResponse.json({ error: "unknown book" }, { status: 404 });

  const serialized = serializeAnchorBounded(anchor);
  if (!serialized.ok) {
    return NextResponse.json({ error: serialized.error }, { status: 400 });
  }
  const anchorJson = serialized.json;
  const clampedPercent =
    typeof percent === "number" && isFinite(percent)
      ? Math.max(0, Math.min(1, percent))
      : 0;

  // Attribution: user.id is the OPDS token owner resolved by the guard, never
  // the cookie session. A token writes only its owner's Progress row.
  const row = await prisma.progress.upsert({
    where: { bookId_userId: { bookId, userId: user.id } },
    create: {
      bookId,
      userId: user.id,
      anchor: anchorJson,
      percent: clampedPercent,
    },
    update: {
      anchor: anchorJson,
      percent: clampedPercent,
    },
  });

  return NextResponse.json({
    bookId: row.bookId,
    percent: row.percent,
    updatedAt: row.updatedAt,
  });
}

// GET /api/opds/progress?bookId=... — OPDS-context reading-progress read.
//
// The read half of the OPDS progress path (android-reader pulls the last
// position saved for its account). It authenticates with the per-user OPDS
// token — NOT the cookie session — and reads only the token owner's Progress
// row, so a token can never see another account's position.
//
// Response mirrors the web reader's GET /api/progress exactly: an existing row
// returns { percent, anchor, updatedAt }; no row returns { percent: 0,
// anchor: null }. Like the session route, this does NOT 404 an unknown book —
// a missing book simply has no progress row and yields the no-row shape.
export async function GET(req: Request) {
  // Authenticate with the OPDS token first; no valid token -> 401 challenge.
  const user = await authenticateOpds(req);
  if (!user) return opdsChallenge();

  const url = new URL(req.url);
  const bookId = url.searchParams.get("bookId");
  if (!bookId) {
    return NextResponse.json({ error: "missing bookId" }, { status: 400 });
  }

  // Read attribution: user.id is the OPDS token owner resolved by the guard.
  // A token reads only its owner's Progress row.
  const row = await prisma.progress.findUnique({
    where: { bookId_userId: { bookId, userId: user.id } },
  });

  if (!row) {
    return NextResponse.json({ percent: 0, anchor: null });
  }

  let anchor: unknown = null;
  if (row.anchor) {
    try {
      anchor = JSON.parse(row.anchor);
    } catch {
      // ignore — anchor was malformed somehow; treat as start
    }
  }

  return NextResponse.json({
    percent: row.percent,
    anchor,
    updatedAt: row.updatedAt,
  });
}
