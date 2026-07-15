"use client";

import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import useSWR from "swr";
import { ArrowLeft, Search, X } from "lucide-react";
import { BookCard, type BookCardData } from "@/components/BookCard";
import { HeaderControls } from "@/components/HeaderControls";
import { fetcher } from "@/lib/fetcher";

interface Facets {
  tags: { name: string; count: number }[];
  formats: { format: string; count: number }[];
}

type Sort = "recent" | "title";

function SearchView() {
  const router = useRouter();
  const params = useSearchParams();

  // Seed state from the URL so a pasted /search?q=… link reproduces the view.
  const [q, setQ] = useState(() => params.get("q") ?? "");
  const [format, setFormat] = useState(() => params.get("format") ?? "");
  const [tag, setTag] = useState(() => params.get("tag") ?? "");
  const [sort, setSort] = useState<Sort>(() =>
    params.get("sort") === "title" ? "title" : "recent",
  );

  // Debounce the text box so each keystroke doesn't fire a request.
  const [debouncedQ, setDebouncedQ] = useState(q);
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q), 250);
    return () => clearTimeout(t);
  }, [q]);

  // Mirror the active filters back into the URL (replace, not push, so the
  // back button leaves search rather than walking every keystroke).
  useEffect(() => {
    const sp = new URLSearchParams();
    if (debouncedQ) sp.set("q", debouncedQ);
    if (format) sp.set("format", format);
    if (tag) sp.set("tag", tag);
    if (sort !== "recent") sp.set("sort", sort);
    const qs = sp.toString();
    router.replace(qs ? `/search?${qs}` : "/search", { scroll: false });
  }, [debouncedQ, format, tag, sort, router]);

  const booksKey = useMemo(() => {
    const sp = new URLSearchParams();
    if (debouncedQ) sp.set("q", debouncedQ);
    if (format) sp.set("format", format);
    if (tag) sp.set("tag", tag);
    sp.set("sort", sort);
    return `/api/books?${sp.toString()}`;
  }, [debouncedQ, format, tag, sort]);

  const { data, isLoading } = useSWR<{ books: BookCardData[] }>(
    booksKey,
    fetcher,
    { keepPreviousData: true },
  );
  const { data: facets } = useSWR<Facets>("/api/books/facets", fetcher);

  const books = data?.books ?? [];
  const hasFilters = !!(debouncedQ || format || tag);

  const clearAll = useCallback(() => {
    setQ("");
    setFormat("");
    setTag("");
    setSort("recent");
  }, []);

  return (
    <main className="mx-auto max-w-7xl px-6 py-8 space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <Link
          href="/"
          className="inline-flex items-center gap-2 text-xs text-zinc-500 transition-colors hover:text-zinc-200"
        >
          <ArrowLeft size={14} />
          Library
        </Link>
        {/* This page IS the search box, so the cluster drops its own. */}
        <HeaderControls search={false} />
      </div>

      {/* Search box */}
      <div className="relative">
        <Search
          size={18}
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500"
        />
        <input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search by title or author…"
          className="w-full rounded-lg border border-zinc-800 bg-zinc-900/60 py-3 pl-11 pr-10 text-base text-zinc-100 placeholder:text-zinc-600 focus:border-amber-500/60 focus:outline-none focus:ring-1 focus:ring-amber-500/30"
        />
        {q && (
          <button
            aria-label="Clear search"
            onClick={() => setQ("")}
            className="absolute right-3 top-1/2 -translate-y-1/2 rounded p-1 text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
          >
            <X size={16} />
          </button>
        )}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <FilterGroup label="Format">
          <Chip active={format === ""} onClick={() => setFormat("")}>
            All
          </Chip>
          {(facets?.formats ?? []).map((f) => (
            <Chip
              key={f.format}
              active={format === f.format}
              onClick={() => setFormat(format === f.format ? "" : f.format)}
            >
              {f.format.toUpperCase()}
              <Count>{f.count}</Count>
            </Chip>
          ))}
        </FilterGroup>

        <FilterGroup label="Sort">
          <Chip active={sort === "recent"} onClick={() => setSort("recent")}>
            Recently added
          </Chip>
          <Chip active={sort === "title"} onClick={() => setSort("title")}>
            Title
          </Chip>
        </FilterGroup>

        {hasFilters && (
          <button
            onClick={clearAll}
            className="text-xs text-zinc-500 underline-offset-2 transition-colors hover:text-zinc-200 hover:underline"
          >
            Clear all
          </button>
        )}
      </div>

      {/* Tag filter — only render the row if any tags exist */}
      {(facets?.tags?.length ?? 0) > 0 && (
        <FilterGroup label="Tags">
          {(facets?.tags ?? []).slice(0, 24).map((t) => (
            <Chip
              key={t.name}
              active={tag === t.name}
              onClick={() => setTag(tag === t.name ? "" : t.name)}
            >
              {t.name}
              <Count>{t.count}</Count>
            </Chip>
          ))}
        </FilterGroup>
      )}

      {/* Results */}
      <div className="space-y-4">
        <p className="px-1 text-xs text-zinc-600">
          {isLoading && !data
            ? "Searching…"
            : `${books.length} ${books.length === 1 ? "result" : "results"}${
                books.length === 200 ? " (showing first 200)" : ""
              }`}
        </p>
        {books.length === 0 && !isLoading ? (
          <p className="px-1 text-sm text-zinc-600">
            {hasFilters
              ? "No books match these filters."
              : "Nothing in the library yet."}
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
            {books.map((b) => (
              <BookCard key={b.id} book={b} />
            ))}
          </div>
        )}
      </div>
    </main>
  );
}

function FilterGroup({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs uppercase tracking-wide text-zinc-600">
        {label}
      </span>
      {children}
    </div>
  );
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition-colors ${
        active
          ? "border-amber-500/40 bg-amber-500/15 text-amber-200"
          : "border-zinc-800 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200"
      }`}
    >
      {children}
    </button>
  );
}

function Count({ children }: { children: ReactNode }) {
  return (
    <span className="text-[10px] tabular-nums text-zinc-600">{children}</span>
  );
}

export default function SearchPage() {
  // useSearchParams() requires a Suspense boundary in the App Router.
  return (
    <Suspense fallback={null}>
      <SearchView />
    </Suspense>
  );
}
