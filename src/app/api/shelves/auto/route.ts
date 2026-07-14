import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withAdmin } from "@/lib/route-helpers";
import { searchOpenLibrary } from "@/lib/metadata/openlibrary";
import { decideShelf } from "@/lib/library/auto-shelve";

// POST /api/shelves/auto — one polite batch of the long-term Unsorted
// fix: look up unshelved books on OpenLibrary by their extracted
// metadata, auto-shelve confident matches, park plausible ones as
// pending suggestions for the existing review flow. Admin-only (it
// writes curation state and spends a third party's API goodwill).
//
// Deliberately BATCHED (oldest first) with a gap between lookups:
// OpenLibrary is a free community service, so a thousand-book library
// is shelved over repeated clicks at a respectful request rate, not in
// one hammering burst. The response reports what happened and how many
// remain; the sorting bench's button re-runs it until done.
const BATCH_SIZE = 20;
const LOOKUP_GAP_MS = 400;
const LOOKUP_TIMEOUT_MS = 8000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Books whose lookup produced nothing usable, remembered for the
// server's lifetime so repeated batches make PROGRESS instead of
// re-querying the same unmatchable books at the front of the queue.
// (Suggested books leave the queue via their pending suggestion; a
// restart retries skips, which is harmless — OpenLibrary data grows.)
const skippedThisRun = new Set<string>();

export const POST = withAdmin(async () => {
  const batch = await prisma.book.findMany({
    where: {
      genre: null,
      id: { notIn: [...skippedThisRun] },
      suggestions: { none: { status: "pending" } },
    },
    orderBy: { addedAt: "asc" },
    take: BATCH_SIZE,
    select: {
      id: true,
      title: true,
      isbn: true,
      authors: { select: { name: true } },
      suggestions: { where: { status: "pending" }, select: { id: true }, take: 1 },
    },
  });

  let shelved = 0;
  let suggested = 0;
  let skipped = 0;

  for (const [i, b] of batch.entries()) {
    if (i > 0) await sleep(LOOKUP_GAP_MS);

    const decision = await decideShelf(
      { id: b.id, title: b.title, isbn: b.isbn, authors: b.authors.map((a) => a.name) },
      (query) =>
        searchOpenLibrary(query, { signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS) }),
    );

    if (decision.action === "shelved") {
      await prisma.book.update({
        where: { id: b.id },
        data: {
          genre: decision.genre,
          // Subjects ride along as tags, same as the accept path — they
          // feed future reclassification if the taxonomy grows.
          tags: {
            connectOrCreate: decision.subjects.map((name) => ({
              where: { name },
              create: { name },
            })),
          },
        },
      });
      shelved += 1;
    } else if (decision.action === "suggested") {
      // Don't stack duplicates on a book that already has a pending
      // suggestion from import-time enrichment.
      if (b.suggestions.length === 0) {
        const s = decision.suggestion;
        await prisma.bookSuggestion.create({
          data: {
            bookId: b.id,
            source: s.source,
            confidence: s.confidence,
            title: s.title ?? null,
            authors: JSON.stringify(s.authors),
            publishedYear: s.publishedYear ?? null,
            publisher: s.publisher ?? null,
            isbn: s.isbn ?? null,
            subjects: JSON.stringify(s.subjects),
            coverUrl: s.coverUrl ?? null,
            workKey: s.workKey ?? null,
          },
        });
      }
      suggested += 1;
    } else {
      skippedThisRun.add(b.id);
      skipped += 1;
    }
  }

  // Remaining = still shelf-less AND still actionable by this loop
  // (not already parked for review, not skipped this run).
  const remaining = await prisma.book.count({
    where: {
      genre: null,
      id: { notIn: [...skippedThisRun] },
      suggestions: { none: { status: "pending" } },
    },
  });
  return NextResponse.json({
    processed: batch.length,
    shelved,
    suggested,
    skipped,
    remaining,
  });
});
