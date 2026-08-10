"use client";

import { BookOpen } from "lucide-react";
import { HeaderControls } from "@/components/HeaderControls";

interface HeaderProps {
  watchedCount: number;
  bookCount: number;
  lastError: string | null;
  onRescan: () => void | Promise<void>;
}

export function LibraryHeader({
  watchedCount,
  bookCount,
  lastError,
  onRescan,
}: HeaderProps) {
  // (Role-gating moved with the icons into the settings hub, which
  // renders role-appropriate entries server-side.)
  return (
    <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4 border-b border-zinc-900 pb-6">
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
            {watchedCount > 0 && (
              <span className="text-zinc-700">
                {"  ·  "}
                {watchedCount} {watchedCount === 1 ? "folder" : "folders"}
              </span>
            )}
          </p>
          {lastError && (
            <p className="text-xs text-amber-500/80">{lastError}</p>
          )}
        </div>
      </div>
      {/* The shared controls cluster (search, settings, theme, sign out);
          Rescan is the library's own action, slotted into its usual spot. */}
      <HeaderControls>
        <button
          onClick={onRescan}
          className="rounded-md px-3 py-1.5 text-xs font-medium text-zinc-400 transition-colors hover:bg-zinc-900 hover:text-zinc-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/60"
        >
          Rescan
        </button>
      </HeaderControls>
    </header>
  );
}
