"use client";

import { useState } from "react";
import useSWR from "swr";
import { ArrowUp, Folder, FolderPlus, Power, Trash2 } from "lucide-react";
import { fetcher } from "@/lib/fetcher";

interface Location {
  id: string;
  path: string;
  enabled: boolean;
  bookCount: number;
  lastScan: string | null;
}

interface FsListing {
  path: string;
  parent: string | null;
  dirs: { name: string; path: string }[];
  bookCount: number;
  error?: string;
}

export function LibraryManager() {
  const { data, mutate } = useSWR<{ locations: Location[] }>(
    "/api/locations",
    fetcher,
  );
  const locations = data?.locations ?? [];

  return (
    <div className="space-y-8">
      <section className="space-y-2">
        <h2 className="text-xs uppercase tracking-wider text-zinc-500">
          Library folders {locations.length > 0 && (
            <span className="text-zinc-700">{locations.length}</span>
          )}
        </h2>
        {locations.length === 0 ? (
          <p className="text-sm text-zinc-600">
            No libraries yet. Browse below and add a folder of EPUBs or PDFs.
          </p>
        ) : (
          <ul className="divide-y divide-zinc-900 rounded-lg border border-zinc-900">
            {locations.map((loc) => (
              <LocationRow key={loc.id} loc={loc} onChanged={() => mutate()} />
            ))}
          </ul>
        )}
      </section>

      <FolderBrowser
        existing={locations.map((l) => l.path)}
        onAdded={() => mutate()}
      />
    </div>
  );
}

function LocationRow({
  loc,
  onChanged,
}: {
  loc: Location;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);

  async function toggle() {
    setBusy(true);
    try {
      await fetch(`/api/locations/${loc.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !loc.enabled }),
      });
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (
      !confirm(
        `Remove ${loc.path}? Its ${loc.bookCount} book(s) leave the library (files on disk are untouched).`,
      )
    )
      return;
    setBusy(true);
    try {
      await fetch(`/api/locations/${loc.id}`, { method: "DELETE" });
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="flex items-center justify-between gap-3 px-4 py-3">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <Folder size={14} className="shrink-0 text-zinc-500" />
          <code className="truncate text-sm text-zinc-200">{loc.path}</code>
        </div>
        <p className="mt-0.5 pl-6 text-xs text-zinc-600">
          {loc.bookCount} book{loc.bookCount === 1 ? "" : "s"}
          {!loc.enabled && " · paused"}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <button
          onClick={toggle}
          disabled={busy}
          title={loc.enabled ? "Pause watching" : "Resume watching"}
          aria-label="Toggle watching"
          className={`rounded p-1.5 transition-colors hover:bg-zinc-900 disabled:opacity-40 ${
            loc.enabled ? "text-amber-400" : "text-zinc-600"
          }`}
        >
          <Power size={15} />
        </button>
        <button
          onClick={remove}
          disabled={busy}
          title="Remove library"
          aria-label="Remove library"
          className="rounded p-1.5 text-zinc-500 transition-colors hover:bg-zinc-900 hover:text-red-400 disabled:opacity-40"
        >
          <Trash2 size={15} />
        </button>
      </div>
    </li>
  );
}

function FolderBrowser({
  existing,
  onAdded,
}: {
  existing: string[];
  onAdded: () => void;
}) {
  // Empty cwd means "no path param": the route defaults to the jail root, so
  // the picker always starts somewhere it's allowed to read. Hardcoding "/"
  // here lands out-of-jail and dead-ends on the uniform 400.
  const [cwd, setCwd] = useState("");
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data, error: fsError } = useSWR<FsListing>(
    cwd ? `/api/fs?path=${encodeURIComponent(cwd)}` : "/api/fs",
    fetcher,
    { keepPreviousData: true },
  );

  // A denied read (uniform 400 -> data.error, or a thrown fetch error) leaves
  // the picker on a path it can't list. Offer a way back to the jail root.
  const denied = !!data?.error || !!fsError;

  const alreadyAdded = data && existing.includes(data.path);

  async function addCurrent() {
    if (!data) return;
    setAdding(true);
    setError(null);
    try {
      const r = await fetch("/api/locations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: data.path }),
      });
      if (!r.ok) {
        const b = await r.json().catch(() => ({}));
        setError(b.error ?? "Couldn't add that folder.");
        return;
      }
      onAdded();
    } finally {
      setAdding(false);
    }
  }

  return (
    <section className="space-y-3 rounded-lg border border-zinc-900 bg-zinc-950 p-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-xs uppercase tracking-wider text-zinc-500">
          Add a library — browse the server
        </h2>
        <button
          onClick={addCurrent}
          disabled={adding || !data || denied || !!alreadyAdded}
          className="inline-flex items-center gap-1.5 rounded-md bg-amber-500/90 px-3 py-1.5 text-xs font-medium text-zinc-950 transition-colors hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <FolderPlus size={14} />
          {alreadyAdded ? "Already added" : "Add this folder"}
        </button>
      </div>

      {/* Current path + book hint */}
      <div className="flex items-center gap-2 text-xs">
        <code className="truncate text-zinc-300">{data?.path ?? cwd}</code>
        {data && !data.error && (
          <span className="shrink-0 text-zinc-600">
            · {data.bookCount} book{data.bookCount === 1 ? "" : "s"} here
          </span>
        )}
      </div>

      {/* Listing */}
      <div className="max-h-72 overflow-y-auto rounded-md border border-zinc-900">
        {denied ? (
          <div className="space-y-2 px-3 py-3">
            <p className="text-sm text-red-400">
              {data?.error ?? "Can't read that directory"}
            </p>
            <button
              onClick={() => setCwd("")}
              className="inline-flex items-center gap-1.5 rounded-md border border-zinc-800 px-2.5 py-1 text-xs text-zinc-300 transition-colors hover:bg-zinc-900 hover:text-zinc-100"
            >
              <ArrowUp size={13} /> Back to start
            </button>
          </div>
        ) : (
          <ul className="divide-y divide-zinc-900/70">
            {data?.parent && (
              <li>
                <button
                  onClick={() => setCwd(data.parent!)}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-zinc-400 transition-colors hover:bg-zinc-900 hover:text-zinc-100"
                >
                  <ArrowUp size={14} /> ..
                </button>
              </li>
            )}
            {(data?.dirs ?? []).map((d) => (
              <li key={d.path}>
                <button
                  onClick={() => setCwd(d.path)}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-zinc-300 transition-colors hover:bg-zinc-900 hover:text-zinc-100"
                >
                  <Folder size={14} className="shrink-0 text-zinc-500" />
                  <span className="truncate">{d.name}</span>
                </button>
              </li>
            ))}
            {data && !data.error && data.dirs.length === 0 && (
              <li className="px-3 py-2 text-sm text-zinc-600">
                No subfolders here.
              </li>
            )}
          </ul>
        )}
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}
    </section>
  );
}
