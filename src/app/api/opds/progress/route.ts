import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticateOpds, opdsChallenge } from "@/lib/opds-auth";
import { parseJson } from "@/lib/parse-json";

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

  const anchorJson = JSON.stringify(anchor);
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
