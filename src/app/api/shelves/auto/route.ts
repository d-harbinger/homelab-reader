import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withAdmin } from "@/lib/route-helpers";
import { lookupOpenLibrary } from "@/lib/metadata/openlibrary";
import { decideShelf } from "@/lib/library/auto-shelve";
import { onlineLookupsEnabled } from "@/lib/app-settings";

// POST /api/shelves/auto — one polite batch of the long-term Unsorted
// fix: look up unshelved books on OpenLibrary by their extracted
// metadata, auto-shelve confident matches, park plausible ones as
// pending suggestions for the existing review flow. Admin-only (it
// writes curation state and spends a third party's API goodwill).
//
// Deliberately BATCHED (oldest first) with a gap between lookups:
// OpenLibrary is a free community service, so a thousand-book library
// is shelved over repeated batches at a respectful request rate, not in
// one hammering burst. The response reports what happened and how many
// remain; the sorting bench's button re-runs it until done.
const BATCH_SIZE = 20;
const LOOKUP_GAP_MS = 400;
const LOOKUP_TIMEOUT_MS = 8000;

// A sweep that runs batch after batch unattended can cross OpenLibrary's
// throttle, and a throttled service answers every remaining lookup with
// nothing. Continuing through that would mark a whole library "no match"
// in a couple of minutes, so the sweep yields the moment the service asks
// it to, and also gives up after a short run of plain failures (an
// unreachable network, a DNS outage) rather than grinding the queue
// against something that is not going to answer.
const MAX_CONSECUTIVE_FAILURES = 3;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Books whose lookup produced nothing usable, remembered for the
// server's lifetime so repeated batches make PROGRESS instead of
// re-querying the same unmatchable books at the front of the queue.
// (Suggested books leave the queue via their pending suggestion; a
// restart retries skips, which is harmless — OpenLibrary data grows.)
//
// ONLY a real answer belongs in here. A book whose lookup was throttled
// or failed is untouched: recording those made an outage permanent —
// the book was excluded from every later batch and from `remaining`, so
// the sweep declared "Done" over books it had never actually looked up.
const skippedThisRun = new Set<string>();

export const POST = withAdmin(async () => {
  // Consent gate: this endpoint exists to contact OpenLibrary, and the
  // deployment may not have opted into online lookups.
  if (!(await onlineLookupsEnabled())) {
    return NextResponse.json(
      { error: "Online lookups are disabled for this install (Settings → Privacy)." },
      { status: 403 },
    );
  }
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
  let failed = 0;
  let processed = 0;
  let consecutiveFailures = 0;
  let stopped: "throttled" | "unreachable" | null = null;

  for (const [i, b] of batch.entries()) {
    if (i > 0) await sleep(LOOKUP_GAP_MS);

    const decision = await decideShelf(
      { id: b.id, title: b.title, isbn: b.isbn, authors: b.authors.map((a) => a.name) },
      async (query) => {
        const { outcome, suggestions } = await lookupOpenLibrary(query, {
          signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS),
        });
        // Throwing is how decideShelf hears "no answer" — the one case it
        // must not read as a verdict on the book.
        if (outcome !== "ok") {
          if (outcome === "throttled") stopped = "throttled";
          throw new Error(outcome);
        }
        return suggestions;
      },
    );

    processed += 1;

    if (decision.action === "failed") {
      // Deliberately NOT added to skippedThisRun: the book is still
      // unlooked-at and must stay in the queue for a later batch.
      failed += 1;
      consecutiveFailures += 1;
      if (stopped === "throttled") break;
      if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        stopped = "unreachable";
        break;
      }
      continue;
    }
    consecutiveFailures = 0;

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
    processed,
    shelved,
    suggested,
    skipped,
    failed,
    // Non-null tells the bench's loop to stop and say why. Without it the
    // loop would keep re-requesting against a service that is refusing.
    stopped,
    remaining,
  });
});
