"use client";

import Link from "next/link";
import useSWR from "swr";
import { ArrowLeft } from "lucide-react";
import { fetcher } from "@/lib/fetcher";
import { GenreShelf } from "@/components/GenreShelf";

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
  const { data, isLoading } = useSWR<{ books: SortRow[] }>(
    "/api/shelves/unsorted",
    fetcher,
  );
  const { data: me } = useSWR<{ user: { role: string } | null }>("/api/me", fetcher);
  const isAdmin = me?.user?.role === "admin";
  const books = data?.books ?? [];

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
        <h1 className="text-lg font-semibold text-zinc-100">Sort the Unsorted pile</h1>
      </div>

      <p className="text-xs text-zinc-500">
        Books land here when nothing identified a shelf for them — most PDFs
        carry no subject metadata, so a technical library starts mostly
        unsorted. Pick a shelf per row; the choice saves immediately and is
        never overwritten by rescans. The Shelves view reflects it right away.
      </p>

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
