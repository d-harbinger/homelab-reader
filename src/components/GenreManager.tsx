"use client";

import { useEffect, useRef, useState } from "react";
import useSWR from "swr";
import { GripVertical, ArrowUp, ArrowDown, Eye, EyeOff } from "lucide-react";
import { fetcher } from "@/lib/fetcher";

interface GenreRow {
  key: string;
  count: number;
  displayName: string | null;
  hidden: boolean;
  order: number | null;
}

// Manage-genres editor. Genres are derived from top-level library folders; this
// edits only their display prefs (order / label / hidden) via PUT /api/genres.
// Reorder by dragging a row or with the up/down buttons (buttons are the
// keyboard/touch-safe path). Nothing here moves files on disk.
export function GenreManager() {
  const { data, isLoading, mutate } = useSWR<{ genres: GenreRow[] }>(
    "/api/genres",
    fetcher,
  );
  const [rows, setRows] = useState<GenreRow[]>([]);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const dragIndex = useRef<number | null>(null);

  // Hydrate the editable copy whenever the server list loads or refreshes.
  useEffect(() => {
    if (data?.genres) setRows(data.genres);
  }, [data]);

  const dirty = data?.genres
    ? JSON.stringify(rows) !== JSON.stringify(data.genres)
    : false;

  function move(from: number, to: number) {
    setRows((r) => {
      if (to < 0 || to >= r.length || from === to) return r;
      const copy = r.slice();
      const [item] = copy.splice(from, 1);
      copy.splice(to, 0, item);
      return copy;
    });
    setSaved(false);
  }

  function setRow(i: number, patch: Partial<GenreRow>) {
    setRows((r) => r.map((row, idx) => (idx === i ? { ...row, ...patch } : row)));
    setSaved(false);
  }

  async function save() {
    setSaving(true);
    try {
      const res = await fetch("/api/genres", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          genres: rows.map((r) => ({
            key: r.key,
            displayName: r.displayName,
            hidden: r.hidden,
          })),
        }),
      });
      if (res.ok) {
        setSaved(true);
        await mutate();
      }
    } finally {
      setSaving(false);
    }
  }

  if (isLoading) {
    return <p className="text-sm text-zinc-500">Loading genres…</p>;
  }
  if (rows.length === 0) {
    return (
      <p className="text-sm text-zinc-500">
        No genres yet — genres appear once you have books inside top-level
        library folders.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <ul className="divide-y divide-zinc-800 rounded-lg border border-zinc-800">
        {rows.map((row, i) => (
          <li
            key={row.key}
            draggable
            onDragStart={() => {
              dragIndex.current = i;
            }}
            onDragOver={(e) => {
              e.preventDefault();
              const from = dragIndex.current;
              if (from === null || from === i) return;
              move(from, i);
              dragIndex.current = i;
            }}
            onDragEnd={() => {
              dragIndex.current = null;
            }}
            className={`flex items-center gap-3 px-3 py-2.5 ${
              row.hidden ? "opacity-50" : ""
            }`}
          >
            <span className="cursor-grab text-zinc-600" title="Drag to reorder">
              <GripVertical size={16} />
            </span>

            <div className="flex min-w-0 flex-col">
              <input
                value={row.displayName ?? ""}
                onChange={(e) => setRow(i, { displayName: e.target.value })}
                placeholder={row.key}
                aria-label={`Display name for ${row.key}`}
                className="w-52 max-w-full bg-transparent text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none"
              />
              <span className="truncate text-[11px] text-zinc-600">
                {row.key} · {row.count} book{row.count === 1 ? "" : "s"}
                {row.hidden ? " · hidden" : ""}
              </span>
            </div>

            <div className="ml-auto flex items-center gap-1">
              <button
                type="button"
                onClick={() => move(i, i - 1)}
                disabled={i === 0}
                title="Move up"
                className="rounded p-1 text-zinc-500 hover:text-zinc-200 disabled:opacity-30"
              >
                <ArrowUp size={15} />
              </button>
              <button
                type="button"
                onClick={() => move(i, i + 1)}
                disabled={i === rows.length - 1}
                title="Move down"
                className="rounded p-1 text-zinc-500 hover:text-zinc-200 disabled:opacity-30"
              >
                <ArrowDown size={15} />
              </button>
              <button
                type="button"
                onClick={() => setRow(i, { hidden: !row.hidden })}
                title={row.hidden ? "Hidden — click to show" : "Visible — click to hide"}
                className="rounded p-1 text-zinc-500 hover:text-zinc-200"
              >
                {row.hidden ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>
          </li>
        ))}
      </ul>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={!dirty || saving}
          className="rounded-md bg-amber-500/90 px-4 py-1.5 text-sm font-medium text-zinc-950 transition-colors hover:bg-amber-400 disabled:opacity-40"
        >
          {saving ? "Saving…" : "Save changes"}
        </button>
        {dirty && <span className="text-xs text-amber-400/80">Unsaved changes</span>}
        {!dirty && saved && <span className="text-xs text-zinc-500">Saved.</span>}
      </div>
    </div>
  );
}
