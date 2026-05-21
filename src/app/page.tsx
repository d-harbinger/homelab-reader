"use client";

import useSWR from "swr";
import { LibraryHeader } from "@/components/LibraryHeader";
import { Section } from "@/components/Section";
import type { BookCardData } from "@/components/BookCard";

interface ScanStatus {
  running: boolean;
  watchedPath: string | null;
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
  const tagSections = tagsResp?.sections ?? [];

  return (
    <main className="mx-auto max-w-7xl px-6 py-10 space-y-12">
      <LibraryHeader
        watchedPath={status?.watchedPath ?? null}
        bookCount={status?.bookCount ?? 0}
        lastError={status?.lastError ?? null}
        onRescan={manualScan}
      />

      <Section
        title="Continue reading"
        books={continueReading}
        hideWhenEmpty
      />

      {tagSections.map((s) => (
        <Section key={s.tag} title={s.tag} books={s.books} />
      ))}

      <Section title="Library" books={books} />

      {books.length === 0 && (
        <p className="text-sm text-zinc-600">
          Drop EPUBs or PDFs into{" "}
          <code className="text-zinc-400">
            {status?.watchedPath ?? "BOOKS_PATH"}
          </code>{" "}
          and they&apos;ll appear here.
        </p>
      )}
    </main>
  );
}
