"use client";

import { useState } from "react";
import { shelfPickerOptions, UNSORTED } from "@/lib/library/genre-taxonomy";

// The book's bookstore shelf, shown on the detail page. Admins get a
// select (the taxonomy list + Unsorted; a custom owner-set shelf stays
// selectable) that PATCHes the allowlisted `genre` field — the manual
// override lane over the on-import classifier. Everyone else sees a
// plain chip. Fill-only automation elsewhere (scanner, enrichment
// accept, rescan backfill) never overwrites what is chosen here.
export function GenreShelf({
  bookId,
  genre,
  editable,
}: {
  bookId: string;
  genre: string | null;
  editable: boolean;
}) {
  const [current, setCurrent] = useState<string | null>(genre);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function change(next: string) {
    const value = next === UNSORTED ? null : next;
    setSaving(true);
    setError("");
    try {
      const res = await fetch(`/api/books/${bookId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ genre: value }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? `HTTP ${res.status}`);
      }
      setCurrent(value);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  if (!editable) {
    return (
      <span className="rounded-full bg-zinc-900 px-3 py-1 text-xs text-zinc-400">
        {current ?? UNSORTED}
      </span>
    );
  }

  const options = shelfPickerOptions(current);

  return (
    <span className="inline-flex items-center gap-2">
      <select
        value={current ?? UNSORTED}
        onChange={(e) => change(e.target.value)}
        disabled={saving}
        aria-label="Shelf"
        className="rounded-md border border-zinc-800 bg-zinc-900/60 px-2 py-1 text-xs text-zinc-300 focus:border-amber-500/60 focus:outline-none disabled:opacity-60"
      >
        <option value={UNSORTED}>{UNSORTED}</option>
        {options.map((g) => (
          <option key={g} value={g}>
            {g}
          </option>
        ))}
      </select>
      {error && <span className="text-xs text-red-400">{error}</span>}
    </span>
  );
}
