"use client";

import Link from "next/link";
import useSWR from "swr";
import { ArrowLeft, Copy } from "lucide-react";
import type { DupGroup } from "@/lib/library/duplicates";
import { fetcher } from "@/lib/fetcher";

// Read-only report of probable same-work duplicates (an epub and a pdf of one
// book, a re-download, an alternate edition). The grouping is done server-side
// by /api/books/duplicates; this page only renders it. Pruning stays a manual,
// deliberate act — nothing here mutates the library.

const REASON_LABEL: Record<DupGroup["reason"], string> = {
  isbn: "Same ISBN",
  "title-author": "Same title & author",
};

export default function DuplicatesPage() {
  const { data, isLoading } = useSWR<{ groups: DupGroup[] }>(
    "/api/books/duplicates",
    fetcher,
  );
  const groups = data?.groups ?? [];

  return (
    <main className="mx-auto max-w-4xl px-6 py-10 space-y-8">
      <Link
        href="/"
        className="inline-flex items-center gap-1.5 text-xs text-zinc-500 transition-colors hover:text-zinc-300"
      >
        <ArrowLeft size={13} />
        Library
      </Link>

      <div className="flex items-center gap-3">
        <span
          aria-hidden
          className="flex h-9 w-9 items-center justify-center rounded-md bg-amber-500/10 text-amber-400 ring-1 ring-inset ring-amber-500/20"
        >
          <Copy size={18} strokeWidth={1.75} />
        </span>
        <div className="space-y-0.5">
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-100">
            Duplicates
          </h1>
          <p className="text-xs text-zinc-500">
            Probable same-work copies — matched by ISBN, then by normalized
            title &amp; author. Review and prune by hand; nothing is deleted
            automatically.
          </p>
        </div>
      </div>

      {isLoading && <p className="text-sm text-zinc-600">Checking…</p>}

      {!isLoading && groups.length === 0 && (
        <p className="text-sm text-zinc-600">
          No duplicates found — every book in the library looks like a distinct
          work.
        </p>
      )}

      <div className="space-y-6">
        {groups.map((g) => (
          <section
            key={g.key}
            className="space-y-3 rounded-lg border border-zinc-900 bg-zinc-950/60 p-4"
          >
            <h2 className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
              {REASON_LABEL[g.reason]}
            </h2>
            <ul className="space-y-2">
              {g.books.map((b) => (
                <li key={b.id}>
                  <Link
                    href={`/books/${b.id}`}
                    className="flex items-center gap-3 rounded-md p-2 transition-colors hover:bg-zinc-900"
                  >
                    <div className="h-14 w-10 flex-none overflow-hidden rounded bg-zinc-900">
                      {b.coverUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={b.coverUrl}
                          alt=""
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-zinc-800 to-zinc-900" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm text-zinc-200">{b.title}</p>
                      <p className="truncate text-xs text-zinc-500">
                        {b.authors.join(", ") || "—"}
                      </p>
                    </div>
                    <span className="flex-none rounded border border-zinc-800 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-zinc-500">
                      {b.format}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </main>
  );
}
