import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { parseJson, withAdmin } from "@/lib/route-helpers";
import { applyAcceptance } from "@/lib/metadata/enrich";
import type { MetadataSuggestion } from "@/lib/metadata/openlibrary";

// The nested dynamic context: /api/books/[id]/suggestions/[sid].
type SuggestionContext = { params: Promise<{ id: string; sid: string }> };

interface AcceptPayload {
  // Per-field "force overwrite" toggle (D-3d). Default false → only empty/
  // fallback Book fields are filled, never clobbering metadata the file carried.
  force?: boolean;
}

// POST /api/books/[id]/suggestions/[sid] — accept a metadata suggestion (D3,
// D-3d). Transactional write-back: the chosen fields fill empty Book columns
// (or overwrite when force), subjects are attached as tags, the accepted row is
// marked "accepted", and its siblings are marked "rejected".
//
// ADMIN-GATED — this writes the SHARED Book catalog row (title/isbn/publisher)
// and attaches library-wide tags, so it is a curation action, not per-user data.
// It is admin-only to match the other shared-state mutators (`scan`,
// `locations`, `users`); the per-book siblings (highlights/notes/progress) are
// `withUser` precisely because they ARE per-user data. (The established pattern
// in self-hosted library servers — e.g. Calibre-Web's "Allow Edit" permission —
// is that editing shared catalog metadata is a privileged capability, never the
// default for every reader. A future granular "can edit metadata" role could
// let specific non-admins curate without full admin.)
//
// A non-existent book/suggestion and a suggestion that belongs to a different
// book collapse to the same 404.
export const POST = withAdmin<SuggestionContext>(async (_admin, req, { params }) => {
  const { id, sid } = await params;

  // force is optional; an absent/empty body is fine (default force=false). Only a
  // genuinely malformed JSON body is a 400.
  let force = false;
  if (req && req.body) {
    const parsed = await parseJson<AcceptPayload>(req);
    if (!parsed.ok) return parsed.res;
    force = parsed.body.force === true;
  }

  const book = await prisma.book.findUnique({ where: { id } });
  if (!book) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // The suggestion must exist AND belong to THIS book. A missing id and a
  // suggestion of another book collapse to one 404 (no cross-book existence leak).
  const row = await prisma.bookSuggestion.findFirst({
    where: { id: sid, bookId: id },
  });
  if (!row) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Rebuild the in-memory MetadataSuggestion shape the pure diff reads (authors/
  // subjects parse back from their JSON columns).
  const suggestion: MetadataSuggestion = {
    source: "openlibrary",
    confidence: row.confidence,
    title: row.title ?? undefined,
    authors: safeParseArray(row.authors),
    publishedYear: row.publishedYear ?? undefined,
    publisher: row.publisher ?? undefined,
    isbn: row.isbn ?? undefined,
    subjects: safeParseArray(row.subjects),
    coverUrl: row.coverUrl ?? undefined,
    workKey: row.workKey ?? undefined,
  };

  // Pure field diff (D-3d): empty-only fill unless force. tagNames is the
  // subjects→tags fill (additive), separated from the scalar Book columns.
  const diff = applyAcceptance(book, suggestion, { force });
  const { tagNames, ...scalars } = diff;

  const bookUpdate: Parameters<typeof prisma.book.update>[0]["data"] = {
    ...scalars,
  };
  if (tagNames && tagNames.length > 0) {
    bookUpdate.tags = {
      connectOrCreate: tagNames.map((name) => ({
        where: { name },
        create: { name },
      })),
    };
  }

  // Transactional: write the Book, accept this suggestion, reject the siblings.
  // All-or-nothing so a partial accept can never leave the book half-updated or
  // two suggestions both "accepted".
  await prisma.$transaction([
    prisma.book.update({ where: { id }, data: bookUpdate }),
    prisma.bookSuggestion.update({
      where: { id: sid },
      data: { status: "accepted" },
    }),
    prisma.bookSuggestion.updateMany({
      where: { bookId: id, id: { not: sid } },
      data: { status: "rejected" },
    }),
  ]);

  return NextResponse.json({
    ok: true,
    accepted: sid,
    applied: { ...scalars, tagNames: tagNames ?? [] },
  });
});

function safeParseArray(s: string): string[] {
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}
