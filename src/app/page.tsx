"use client";

import useSWR from "swr";
import Link from "next/link";
import { LibraryHeader } from "@/components/LibraryHeader";
import { Section } from "@/components/Section";
import type { BookCardData } from "@/components/BookCard";

interface ScanStatus {
  running: boolean;
  watchedPaths: string[];
  lastError: string | null;
  lastFullScanAt: string | null;
  bookCount: number;
}

interface ContinueRow {
  id: string;
  title: string;
  format: "epub" | "pdf";
  authors: string[];
  pageCount: number | null;
  coverUrl: string | null;
  percent: number;
}

interface TagSection {
  tag: string;
  books: BookCardData[];
}

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export default function Home() {
  const { data: status, mutate: refreshStatus } = useSWR<ScanStatus>(
    "/api/scan/status",
    fetcher,
    { refreshInterval: 5000 },
  );
  const { data: booksResp, mutate: refreshBooks } = useSWR<{
    books: BookCardData[];
  }>("/api/books", fetcher, { refreshInterval: 5000 });
  const { data: continueResp } = useSWR<{ books: ContinueRow[] }>(
    "/api/progress/recent",
    fetcher,
    { refreshInterval: 10000 },
  );
  const { data: recentResp } = useSWR<{ books: BookCardData[] }>(
    "/api/books/recent",
    fetcher,
    { refreshInterval: 10000 },
  );
  const { data: tagsResp } = useSWR<{ sections: TagSection[] }>(
    "/api/tags/sections",
    fetcher,
    { refreshInterval: 30000 },
  );

  async function manualScan() {
    await fetch("/api/scan", { method: "POST" });
    await Promise.all([refreshStatus(), refreshBooks()]);
  }

  const books = booksResp?.books ?? [];
  const continueReading = continueResp?.books ?? [];
  const recentlyAdded = recentResp?.books ?? [];
  const tagSections = tagsResp?.sections ?? [];

  // Don't echo Recently Added if the library is small enough that it'd
  // duplicate the entire Library grid below — keeps tiny libraries from
  // looking padded.
  const showRecent = recentlyAdded.length >= 4 && books.length > recentlyAdded.length;

  return (
    <main className="mx-auto max-w-7xl px-6 py-10 space-y-12">
      <LibraryHeader
        watchedPaths={status?.watchedPaths ?? []}
        bookCount={status?.bookCount ?? 0}
        lastError={status?.lastError ?? null}
        onRescan={manualScan}
      />

      <Section
        title="Continue reading"
        books={continueReading}
        hideWhenEmpty
      />

      {showRecent && (
        <Section title="Recently added" books={recentlyAdded} />
      )}

      {tagSections.map((s) => (
        <Section key={s.tag} title={s.tag} books={s.books} />
      ))}

      <Section title="Library" books={books} layout="grid" />

      {books.length === 0 && (
        <p className="text-sm text-zinc-600">
          {(status?.watchedPaths?.length ?? 0) === 0 ? (
            <>
              No library folders yet. An admin can add one in{" "}
              <Link
                href="/settings/libraries"
                className="text-amber-400/90 underline-offset-2 hover:underline"
              >
                Settings → Libraries
              </Link>
              .
            </>
          ) : (
            "No books found yet — drop EPUBs or PDFs into a library folder and they'll appear here."
          )}
        </p>
      )}
    </main>
  );
}
