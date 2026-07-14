"use client";

import { useEffect, useState } from "react";
import useSWR, { mutate } from "swr";
import Link from "next/link";
import { LibraryHeader } from "@/components/LibraryHeader";
import { FailedImportsBanner } from "@/components/FailedImportsBanner";
import { Section } from "@/components/Section";
import { FolderTree } from "@/components/FolderTree";
import type { BookCardData } from "@/components/BookCard";
import { fetcher } from "@/lib/fetcher";

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

  return (
    <main className="mx-auto max-w-7xl px-6 py-10 space-y-12">
      <LibraryHeader
        watchedPaths={status?.watchedPaths ?? []}
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

      {view === "shelves" && (
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
                Sort the Unsorted pile →
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
              ) : (status?.watchedPaths?.length ?? 0) === 0 ? (
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

      {view === "folders" && (
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
              <div className="flex items-center justify-between">
                <h2 className="text-xs font-medium uppercase tracking-wider text-zinc-500">
                  Folder genres
                </h2>
                <span className="flex items-center gap-4">
                  {/* Server-generated mv script projecting the assigned
                      shelves onto the folder layout; review + run host-side,
                      then rescan (hash re-link keeps annotations). */}
                  <a
                    href="/api/library/organize-plan"
                    className="text-xs text-zinc-500 transition-colors hover:text-zinc-200"
                  >
                    Organize script
                  </a>
                  <Link
                    href="/settings/genres"
                    className="text-xs text-zinc-500 transition-colors hover:text-zinc-200"
                  >
                    Manage genres
                  </Link>
                </span>
              </div>
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
              ) : (status?.watchedPaths?.length ?? 0) === 0 ? (
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
