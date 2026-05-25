"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import { BookOpen, FolderTree, LogOut, Search, Users } from "lucide-react";
import { doSignOut } from "@/app/actions";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface HeaderProps {
  watchedPaths: string[];
  bookCount: number;
  lastError: string | null;
  onRescan: () => void | Promise<void>;
}

export function LibraryHeader({
  watchedPaths,
  bookCount,
  lastError,
  onRescan,
}: HeaderProps) {
  const router = useRouter();
  const [term, setTerm] = useState("");
  const { data: me } = useSWR<{ user: { role: string } | null }>(
    "/api/me",
    fetcher,
  );
  const isAdmin = me?.user?.role === "admin";

  function submitSearch(e: FormEvent) {
    e.preventDefault();
    const q = term.trim();
    router.push(q ? `/search?q=${encodeURIComponent(q)}` : "/search");
  }

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
            {watchedPaths.length > 0 && (
              <span className="text-zinc-700">
                {"  ·  "}
                {watchedPaths.length}{" "}
                {watchedPaths.length === 1 ? "folder" : "folders"}
              </span>
            )}
          </p>
          {lastError && (
            <p className="text-xs text-amber-500/80">{lastError}</p>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2">
        <form onSubmit={submitSearch} className="relative">
          <Search
            size={15}
            className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-500"
          />
          <input
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder="Search…"
            aria-label="Search the library"
            className="w-44 rounded-md border border-zinc-800 bg-zinc-900/60 py-1.5 pl-8 pr-3 text-xs text-zinc-100 placeholder:text-zinc-600 transition-[width] focus:w-56 focus:border-amber-500/60 focus:outline-none focus:ring-1 focus:ring-amber-500/30"
          />
        </form>
        <button
          onClick={onRescan}
          className="rounded-md px-3 py-1.5 text-xs font-medium text-zinc-400 transition-colors hover:bg-zinc-900 hover:text-zinc-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/60"
        >
          Rescan
        </button>
        {isAdmin && (
          <>
            <Link
              href="/settings/libraries"
              aria-label="Manage libraries"
              title="Libraries"
              className="rounded-md p-1.5 text-zinc-500 transition-colors hover:bg-zinc-900 hover:text-zinc-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/60"
            >
              <FolderTree size={15} />
            </Link>
            <Link
              href="/settings/users"
              aria-label="Manage users"
              title="Users"
              className="rounded-md p-1.5 text-zinc-500 transition-colors hover:bg-zinc-900 hover:text-zinc-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/60"
            >
              <Users size={15} />
            </Link>
          </>
        )}
        <form action={doSignOut}>
          <button
            type="submit"
            aria-label="Sign out"
            title="Sign out"
            className="rounded-md p-1.5 text-zinc-500 transition-colors hover:bg-zinc-900 hover:text-zinc-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/60"
          >
            <LogOut size={15} />
          </button>
        </form>
      </div>
    </header>
  );
}
