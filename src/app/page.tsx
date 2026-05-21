"use client";

import useSWR from "swr";

interface BookSummary {
  id: string;
  title: string;
  format: "epub" | "pdf";
  authors: string[];
  language: string | null;
  pageCount: number | null;
  fileSizeBytes: number | null;
  coverUrl: string | null;
  addedAt: string;
}

interface ScanStatus {
  running: boolean;
  watchedPath: string | null;
  lastError: string | null;
  lastFullScanAt: string | null;
  bookCount: number;
  lastScannedAt: string | null;
}

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export default function Home() {
  const { data: status, mutate: refreshStatus } = useSWR<ScanStatus>(
    "/api/scan/status",
    fetcher,
    { refreshInterval: 5000 },
  );
  const { data: books, mutate: refreshBooks } = useSWR<{ books: BookSummary[] }>(
    "/api/books",
    fetcher,
    { refreshInterval: 5000 },
  );

  async function manualScan() {
    await fetch("/api/scan", { method: "POST" });
    await Promise.all([refreshStatus(), refreshBooks()]);
  }

  return (
    <main className="min-h-screen p-8 max-w-6xl mx-auto">
      <header className="flex items-baseline justify-between mb-8">
        <h1 className="text-2xl font-semibold">homelab-reader</h1>
        <button
          onClick={manualScan}
          className="px-3 py-1.5 text-sm rounded bg-zinc-800 hover:bg-zinc-700 border border-zinc-700"
        >
          Rescan
        </button>
      </header>

      <section className="mb-8 text-sm text-zinc-400 space-y-1">
        <div>
          Watching:{" "}
          <code className="text-zinc-200">
            {status?.watchedPath ?? "(not started)"}
          </code>
        </div>
        <div>
          Books: <span className="text-zinc-200">{status?.bookCount ?? 0}</span>
          {status?.lastFullScanAt && (
            <>
              {" "}· Last full scan:{" "}
              <span className="text-zinc-200">
                {new Date(status.lastFullScanAt).toLocaleString()}
              </span>
            </>
          )}
        </div>
        {status?.lastError && (
          <div className="text-amber-400">⚠ {status.lastError}</div>
        )}
      </section>

      {books && books.books.length === 0 && (
        <p className="text-zinc-500 text-sm">
          No books yet. Drop EPUBs or PDFs into{" "}
          <code className="text-zinc-300">
            {status?.watchedPath ?? "BOOKS_PATH"}
          </code>{" "}
          and they&apos;ll appear here.
        </p>
      )}

      {books && books.books.length > 0 && (
        <ul className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
          {books.books.map((b) => (
            <li
              key={b.id}
              className="bg-zinc-900 border border-zinc-800 rounded p-2 flex flex-col gap-2"
            >
              <div className="aspect-[2/3] bg-zinc-800 rounded overflow-hidden flex items-center justify-center text-zinc-600 text-xs">
                {b.coverUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={b.coverUrl}
                    alt={b.title}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <span className="uppercase">{b.format}</span>
                )}
              </div>
              <div className="text-sm font-medium text-zinc-100 line-clamp-2">
                {b.title}
              </div>
              <div className="text-xs text-zinc-400 line-clamp-1">
                {b.authors.length > 0 ? b.authors.join(", ") : "Unknown author"}
              </div>
              <div className="text-[10px] uppercase tracking-wider text-zinc-500">
                {b.format}
                {b.pageCount ? ` · ${b.pageCount}p` : ""}
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
