"use client";

import { useEffect, useState } from "react";
import useSWR, { mutate } from "swr";
import Link from "next/link";
import { LibraryHeader } from "@/components/LibraryHeader";
import { FailedImportsBanner } from "@/components/FailedImportsBanner";
import { Section } from "@/components/Section";
import { FolderTree } from "@/components/FolderTree";
import type { BookCardData } from "@/components/BookCard";
import {
  HIGHLIGHT_COLORS,
  HIGHLIGHT_ORDER,
  type HighlightColor,
} from "@/lib/highlight-colors";
import { fetcher } from "@/lib/fetcher";

interface ScanStatus {
  running: boolean;
  // A COUNT, not the paths. /api/scan/status serves the absolute library roots
  // to admins only — they are home-directory paths on a homelab — and this
  // screen never needed more than "how many folders" anyway.
  watchedCount: number;
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

interface GenreSection {
  genre: string; // raw folder key (stable React key)
  label: string; // display name (rename override, else the key)
  books: BookCardData[];
}

interface ShelfSection {
  genre: string; // taxonomy shelf name (or a custom one / "Unsorted")
  label: string;
  count: number;
  books: BookCardData[];
}

// The two library views. Shelves = the bookstore: metadata-assigned
// genres (lib/library/genre-taxonomy) with Continue/Recently rows.
// Folders = disk truth: the folder rail + the filterable grid. The
// choice persists per browser.
type LibraryView = "shelves" | "folders";
const VIEW_KEY = "hlr-library-view";

export default function Home() {
  // The selected folder rail path ("" = all books / no filter). When set, the
  // library query carries it through to the server-side folder filter.
  const [selectedFolder, setSelectedFolder] = useState("");

  const [view, setView] = useState<LibraryView>("shelves");
  useEffect(() => {
    try {
      if (localStorage.getItem(VIEW_KEY) === "folders") setView("folders");
    } catch {
      /* storage unavailable — default view stands */
    }
  }, []);
  function switchView(next: LibraryView) {
    setView(next);
    try {
      localStorage.setItem(VIEW_KEY, next);
    } catch {
      /* storage unavailable */
    }
  }

  const { data: status, mutate: refreshStatus } = useSWR<ScanStatus>(
    "/api/scan/status",
    fetcher,
    { refreshInterval: 5000 },
  );
  const booksKey = selectedFolder
    ? `/api/books?folder=${encodeURIComponent(selectedFolder)}`
    : "/api/books";
  const { data: booksResp, mutate: refreshBooks } = useSWR<{
    books: BookCardData[];
  }>(booksKey, fetcher, { refreshInterval: 5000 });
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
  const { data: genresResp } = useSWR<{ sections: GenreSection[] }>(
    "/api/genres/sections",
    fetcher,
    { refreshInterval: 30000 },
  );
  const { data: shelvesResp } = useSWR<{ sections: ShelfSection[] }>(
    "/api/shelves/sections",
    fetcher,
    { refreshInterval: 30000 },
  );
  // The reader's highlight colors per book, for the "filter by highlight color"
  // bar. A stable /api/books fetch backs the filtered grid so it spans the whole
  // library regardless of the folder rail (SWR dedupes it with the shelves-view
  // books key, which is already "/api/books").
  const { data: hlColorsResp } = useSWR<{
    byBook: Record<string, Record<string, number>>;
  }>("/api/books/highlight-colors", fetcher, { refreshInterval: 30000 });
  const { data: allBooksResp } = useSWR<{ books: BookCardData[] }>(
    "/api/books",
    fetcher,
    { refreshInterval: 30000 },
  );
  const [hlFilter, setHlFilter] = useState<Set<HighlightColor>>(new Set());
  function toggleHlColor(c: HighlightColor) {
    setHlFilter((prev) => {
      const next = new Set(prev);
      if (next.has(c)) next.delete(c);
      else next.add(c);
      return next;
    });
  }

  async function manualScan() {
    await fetch("/api/scan", { method: "POST" });
    // The folder rail derives from books' paths, so a rescan can add or
    // remove folders — revalidate it alongside the grids or it goes stale.
    await Promise.all([
      refreshStatus(),
      refreshBooks(),
      mutate("/api/library/folders"),
    ]);
  }

  const books = booksResp?.books ?? [];
  const continueReading = continueResp?.books ?? [];
  const recentlyAdded = recentResp?.books ?? [];
  const genreSections = genresResp?.sections ?? [];
  // Note: the raw-subject tag rows (/api/tags/sections) no longer render
  // on the home page — the normalized bookstore shelves supersede them.
  // The tag data itself stays; it feeds the classifier and the backfill.
  const shelfSections = shelvesResp?.sections ?? [];

  // Don't echo Recently Added if the library is small enough that it'd
  // duplicate the entire Library grid below — keeps tiny libraries from
  // looking padded.
  const showRecent = recentlyAdded.length >= 4 && books.length > recentlyAdded.length;

  // The curated shelves (Continue reading, Recently added, tags) describe the
  // whole library; once a folder is selected they'd be misleading, so the rail
  // narrows the view to a single filtered Library grid.
  const folderActive = selectedFolder !== "";
  const libraryTitle = folderActive ? selectedFolder : "Library";

  // Highlight-color filter. The chips show only colors that actually appear in
  // the library (with how many books carry each); selecting one or more narrows
  // the whole library to books holding any of those colors — one flat grid, so
  // "every book with a green key-term mark" is one glance.
  const byBook = hlColorsResp?.byBook ?? {};
  const allBooks = allBooksResp?.books ?? [];
  const colorBookCounts = HIGHLIGHT_ORDER.map((color) => ({
    color,
    books: Object.values(byBook).filter((m) => m[color]).length,
  })).filter((c) => c.books > 0);
  const hlActive = hlFilter.size > 0;
  const filteredBooks: BookCardData[] = hlActive
    ? allBooks
        .filter((b) => {
          const m = byBook[b.id];
          return m ? [...hlFilter].some((c) => m[c]) : false;
        })
        .map((b) => ({
          ...b,
          highlightColors: HIGHLIGHT_ORDER.filter(
            (c) => byBook[b.id]?.[c],
          ).map((c) => ({ color: c, count: byBook[b.id][c] })),
        }))
    : [];

  return (
    <main className="mx-auto max-w-7xl px-6 py-10 space-y-12">
      <LibraryHeader
        watchedCount={status?.watchedCount ?? 0}
        bookCount={status?.bookCount ?? 0}
        lastError={status?.lastError ?? null}
        onRescan={manualScan}
      />

      <FailedImportsBanner />

      {/* Shelves = the bookstore view (metadata genres); Folders = disk
          truth (the folder rail + filterable grid). One choice, remembered. */}
      <div
        role="tablist"
        aria-label="Library view"
        className="inline-flex rounded-md border border-zinc-800 p-0.5 text-xs"
      >
        {(["shelves", "folders"] as const).map((v) => (
          <button
            key={v}
            role="tab"
            aria-selected={view === v}
            onClick={() => switchView(v)}
            className={`rounded px-3 py-1.5 font-medium capitalize transition-colors ${
              view === v
                ? "bg-zinc-900 text-zinc-100"
                : "text-zinc-500 hover:text-zinc-200"
            }`}
          >
            {v}
          </button>
        ))}
      </div>

      {/* Filter the whole library to books carrying a given highlight color —
          the way to see, at a glance, every book with the marks a reader
          color-codes (e.g. green = key terms). Only colors present in the
          library appear. */}
      {colorBookCounts.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
            Highlights
          </span>
          {colorBookCounts.map(({ color, books: n }) => {
            const on = hlFilter.has(color);
            return (
              <button
                key={color}
                aria-pressed={on}
                onClick={() => toggleHlColor(color)}
                title={`${HIGHLIGHT_COLORS[color].label} — ${n} book${n === 1 ? "" : "s"}`}
                className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors ${
                  on
                    ? "border-zinc-100 bg-zinc-800 text-zinc-100"
                    : "border-zinc-800 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200"
                }`}
              >
                <span
                  className="h-3 w-3 rounded-full ring-1 ring-white/25"
                  style={{ background: HIGHLIGHT_COLORS[color].swatch }}
                />
                {HIGHLIGHT_COLORS[color].label}
                <span className="text-zinc-500">{n}</span>
              </button>
            );
          })}
          {hlActive && (
            <button
              onClick={() => setHlFilter(new Set())}
              className="text-xs text-amber-400/90 underline-offset-2 hover:underline"
            >
              Clear
            </button>
          )}
        </div>
      )}

      {hlActive && (
        <Section
          title={
            filteredBooks.length === 1
              ? "1 book highlighted"
              : `${filteredBooks.length} books highlighted`
          }
          books={filteredBooks}
          layout="grid"
        />
      )}

      {!hlActive && view === "shelves" && (
        <div className="space-y-12">
          <Section
            title="Continue reading"
            books={continueReading}
            hideWhenEmpty
          />

          {showRecent && (
            <Section title="Recently added" books={recentlyAdded} />
          )}

          {shelfSections.some((s) => s.genre === "Unsorted") && (
            <div className="flex items-center justify-end">
              <Link
                href="/sort"
                className="text-xs text-amber-400/90 underline-offset-2 hover:underline"
              >
                Sort unsorted books →
              </Link>
            </div>
          )}

          {shelfSections.map((s) => (
            <Section
              key={s.genre}
              title={s.count > s.books.length ? `${s.label} · ${s.count}` : s.label}
              books={s.books}
            />
          ))}

          {shelfSections.length === 0 && (
            <p className="text-sm text-zinc-600">
              {books.length > 0 ? (
                "No shelves yet — run a rescan to classify the library."
              ) : (status?.watchedCount ?? 0) === 0 ? (
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
        </div>
      )}

      {!hlActive && view === "folders" && (
      <div className="flex flex-col gap-8 lg:flex-row">
        {/* self-start stops the default flex stretch so the rail is shorter
            than the scroll area and sticky has room to travel; its own
            overflow keeps tall trees scrollable within the viewport. */}
        <aside className="scroll-slim lg:sticky lg:top-6 lg:max-h-[calc(100vh-3rem)] lg:w-56 lg:flex-none lg:self-start lg:overflow-y-auto">
          <FolderTree
            selected={selectedFolder}
            onSelect={setSelectedFolder}
          />
        </aside>

        <div className="min-w-0 flex-1 space-y-12">
          {!folderActive && (
            <Section
              title="Continue reading"
              books={continueReading}
              hideWhenEmpty
            />
          )}

          {!folderActive && genreSections.length > 0 && (
            <div className="space-y-12">
              {/* The organize-script and genre-prefs entries moved to the
                  settings hub (owner ruling: this header isn't their place). */}
              <h2 className="text-xs font-medium uppercase tracking-wider text-zinc-500">
                Folder genres
              </h2>
              {genreSections.map((s) => (
                <Section key={s.genre} title={s.label} books={s.books} />
              ))}
            </div>
          )}

          <Section title={libraryTitle} books={books} layout="grid" />

          {books.length === 0 && (
            <p className="text-sm text-zinc-600">
              {folderActive ? (
                "No books in this folder."
              ) : (status?.watchedCount ?? 0) === 0 ? (
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
        </div>
      </div>
      )}
    </main>
  );
}
