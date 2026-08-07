"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import { ArrowLeft, Sparkles } from "lucide-react";
import { fetcher } from "@/lib/fetcher";
import { GenreShelf } from "@/components/GenreShelf";

interface AutoResult {
  processed: number;
  shelved: number;
  suggested: number;
  skipped: number;
  /** Lookups the service never answered — the books stay in the queue. */
  failed: number;
  /** Set when the server yielded; the loop must stop and say why. */
  stopped: "throttled" | "unreachable" | null;
  remaining: number;
}

// The bulk-sorting bench: every book still on the Unsorted pile, one
// row each, with the same shelf picker the detail page carries — so a
// PDF-heavy library (PDFs embed no subjects for the auto-classifier)
// can be shelved in one sitting instead of book-by-book through detail
// pages. Rows stay listed after a pick (so a mis-pick is fixable);
// the pile shrinks on the next visit or refresh.
interface SortRow {
  id: string;
  title: string;
  authors: string[];
  genre: string | null;
}

export default function SortPage() {
  const { data, isLoading, mutate } = useSWR<{ books: SortRow[] }>(
    "/api/shelves/unsorted",
    fetcher,
  );
  const { data: me } = useSWR<{ user: { role: string } | null }>("/api/me", fetcher);
  const { data: privacy } = useSWR<{ onlineLookups: boolean }>(
    "/api/settings/privacy",
    fetcher,
  );
  const isAdmin = me?.user?.role === "admin";
  const books = data?.books ?? [];

  const [autoBusy, setAutoBusy] = useState(false);
  const [autoMsg, setAutoMsg] = useState("");
  const stopRef = useRef(false);

  // One click runs polite batch after polite batch until the pile is
  // cleared (a 400-book library meant ~20 attended clicks under the old
  // one-batch-per-click design; reruled 2026-08-06). Politeness to
  // OpenLibrary is unchanged — the server caps each batch and paces the
  // lookups; this loop only saves the re-clicks. Stop returns control
  // after the batch in flight; a batch is atomic on the server, so
  // mid-batch cancellation isn't a thing to offer.
  //
  // The loop also yields when the SERVER says to (`stopped`): an
  // unattended sweep is long enough to meet OpenLibrary's throttle, and
  // hammering through that answers every remaining book with nothing.
  // Books the service never answered stay in the queue for a later run,
  // so the summary reports them apart from a genuine "no match".
  async function runAutoLookup() {
    setAutoBusy(true);
    setAutoMsg("");
    stopRef.current = false;
    const total = { processed: 0, shelved: 0, suggested: 0, skipped: 0, failed: 0 };
    let batches = 0;
    try {
      for (;;) {
        const res = await fetch("/api/shelves/auto", { method: "POST" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const r = (await res.json()) as AutoResult;
        batches += 1;
        total.processed += r.processed;
        total.shelved += r.shelved;
        total.suggested += r.suggested;
        total.skipped += r.skipped;
        total.failed += r.failed;
        // processed === 0 with books remaining should be unreachable
        // (every processed book leaves the queue), but treat it as done
        // rather than risk spinning against a surprise.
        const done = r.remaining === 0 || r.processed === 0;
        const yielded = r.stopped;
        const stopped = !done && (stopRef.current || !!yielded);
        const lead =
          yielded === "throttled"
            ? "Paused — OpenLibrary asked for a break; "
            : yielded === "unreachable"
              ? "Paused — OpenLibrary is not answering; "
              : stopped
                ? "Stopped — "
                : "";
        setAutoMsg(
          // Books the service never answered for are not "looked up".
          `${lead}looked up ${total.processed - total.failed} in ${batches} ` +
            `${batches === 1 ? "batch" : "batches"}: ${total.shelved} shelved, ` +
            `${total.suggested} saved for review, ${total.skipped} no match.` +
            (total.failed > 0 ? ` ${total.failed} not answered — still queued.` : "") +
            (r.remaining > 0 ? ` ${r.remaining} remaining.` : " Done."),
        );
        await mutate();
        if (done || stopped) break;
      }
    } catch (err) {
      setAutoMsg(`Lookup failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setAutoBusy(false);
    }
  }

  return (
    <main className="mx-auto max-w-3xl px-6 py-10 space-y-6">
      <div className="flex items-center justify-between">
        <Link
          href="/"
          className="inline-flex items-center gap-2 text-xs text-zinc-500 hover:text-zinc-200 transition-colors"
        >
          <ArrowLeft size={14} />
          Library
        </Link>
        <h1 className="text-lg font-semibold text-zinc-100">Sort books</h1>
      </div>

      <p className="text-xs text-zinc-500">
        Books land here when nothing identified a shelf for them — most PDFs
        carry no subject metadata, so a technical library starts mostly
        unsorted. Pick a shelf per row; the choice saves immediately and is
        never overwritten by rescans. The Shelves view reflects it right away.
      </p>

      {isAdmin && !privacy?.onlineLookups && (
        <p className="text-xs text-zinc-500">
          Online lookups are off, so shelving here is manual. To enable
          OpenLibrary lookups for unsorted books, see{" "}
          <Link
            href="/settings/privacy"
            className="text-amber-400/90 underline-offset-2 hover:underline"
          >
            Settings → Privacy
          </Link>
          .
        </p>
      )}

      {isAdmin && privacy?.onlineLookups && (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <button
              onClick={runAutoLookup}
              disabled={autoBusy || books.length === 0}
              className="inline-flex items-center gap-2 rounded-md bg-amber-500 px-3 py-1.5 text-xs font-medium text-zinc-950 transition-colors hover:bg-amber-400 disabled:opacity-50"
            >
              <Sparkles size={14} />
              {autoBusy ? "Looking books up…" : "Look shelves up online"}
            </button>
            {autoBusy && (
              <button
                onClick={() => {
                  stopRef.current = true;
                }}
                className="rounded-md border border-zinc-800 px-3 py-1.5 text-xs text-zinc-300 transition-colors hover:border-zinc-600 hover:text-zinc-100"
              >
                Stop after this batch
              </button>
            )}
          </div>
          <p className="text-xs text-zinc-600">
            Looks each book up on OpenLibrary by title/author/ISBN. Confident
            matches are shelved directly; uncertain ones are saved as metadata
            suggestions to review on the book&apos;s page. Runs in rate-limited
            batches of 20 until the pile is cleared; stop any time.
          </p>
          {autoMsg && <p className="text-xs text-zinc-400">{autoMsg}</p>}
        </div>
      )}

      {isLoading && <p className="text-sm text-zinc-600">Loading…</p>}
      {!isLoading && books.length === 0 && (
        <p className="text-sm text-zinc-600">
          Nothing unsorted — the whole library has a shelf.
        </p>
      )}

      <ul className="divide-y divide-zinc-900">
        {books.map((b) => (
          <li key={b.id} className="flex items-center justify-between gap-4 py-2.5">
            <div className="min-w-0">
              <Link
                href={`/books/${b.id}`}
                className="block truncate text-sm text-zinc-200 hover:text-amber-400 transition-colors"
              >
                {b.title}
              </Link>
              {b.authors.length > 0 && (
                <p className="truncate text-xs text-zinc-600">{b.authors.join(", ")}</p>
              )}
            </div>
            <GenreShelf bookId={b.id} genre={b.genre} editable={isAdmin} />
          </li>
        ))}
      </ul>
    </main>
  );
}
