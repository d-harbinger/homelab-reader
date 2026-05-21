"use client";

import { BookOpen } from "lucide-react";

interface HeaderProps {
  watchedPath: string | null;
  bookCount: number;
  lastError: string | null;
  onRescan: () => void | Promise<void>;
}

export function LibraryHeader({
  watchedPath,
  bookCount,
  lastError,
  onRescan,
}: HeaderProps) {
  return (
    <header className="flex items-end justify-between gap-6 border-b border-zinc-900 pb-6">
      <div className="flex items-center gap-3">
        <span
          aria-hidden
          className="flex h-9 w-9 items-center justify-center rounded-md bg-amber-500/10 text-amber-400 ring-1 ring-inset ring-amber-500/20"
        >
          <BookOpen size={18} strokeWidth={1.75} />
        </span>
        <div className="space-y-0.5">
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-100">
            homelab-reader
          </h1>
          <p className="text-xs text-zinc-500">
            {bookCount === 0
              ? "Nothing here yet"
              : `${bookCount} ${bookCount === 1 ? "book" : "books"}`}
            {watchedPath && (
              <span className="text-zinc-700">
                {"  ·  "}
                <code className="text-zinc-500">{watchedPath}</code>
              </span>
            )}
          </p>
          {lastError && (
            <p className="text-xs text-amber-500/80">{lastError}</p>
          )}
        </div>
      </div>
      <button
        onClick={onRescan}
        className="rounded-md px-3 py-1.5 text-xs font-medium text-zinc-400 transition-colors hover:bg-zinc-900 hover:text-zinc-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/60"
      >
        Rescan
      </button>
    </header>
  );
}
