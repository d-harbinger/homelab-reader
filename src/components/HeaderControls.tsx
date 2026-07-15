"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { LogOut, Search, Settings } from "lucide-react";
import { doSignOut } from "@/app/actions";
import { ThemeToggle } from "@/components/ThemeToggle";

// The header's right-hand cluster — search, the settings door, the theme
// toggle, sign out — extracted from LibraryHeader so every top-level page
// (library, book detail, search, settings) offers the same controls instead
// of stranding them on the home page. The readers keep their own slimmer
// toolbars. Pages slot page-specific actions (the library's Rescan) via
// children, rendered between search and the settings door — the position the
// Rescan button always had. `search`/`settings` switch off the pieces a page
// already embodies: /search is a full-page search box, /settings is the door.
export function HeaderControls({
  search = true,
  settings = true,
  children,
}: {
  search?: boolean;
  settings?: boolean;
  children?: React.ReactNode;
}) {
  const router = useRouter();
  const [term, setTerm] = useState("");

  function submitSearch(e: FormEvent) {
    e.preventDefault();
    const q = term.trim();
    router.push(q ? `/search?q=${encodeURIComponent(q)}` : "/search");
  }

  return (
    <div className="flex items-center gap-2">
      {search && (
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
      )}
      {children}
      {settings && (
        <Link
          href="/settings"
          aria-label="Settings"
          title="Settings"
          className="rounded-md p-1.5 text-zinc-500 transition-colors hover:bg-zinc-900 hover:text-zinc-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/60"
        >
          <Settings size={15} />
        </Link>
      )}
      <ThemeToggle />
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
  );
}
