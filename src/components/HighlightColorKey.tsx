"use client";

import { useState } from "react";
import useSWR from "swr";
import {
  HIGHLIGHT_COLORS,
  HIGHLIGHT_ORDER,
  type ColorKeyMap,
  type HighlightColor,
} from "@/lib/highlight-colors";
import { fetcher } from "@/lib/fetcher";

// The book's highlight color key — the legend on a textbook's inside cover.
// Each palette color gets an optional meaning ("yellow = key terms, blue =
// organizations"); the readers show the labels as swatch tooltips and a panel
// legend, and the flashcard export tags cards by them. Lives on the book
// detail page; per-user, so it saves without any admin gate.
//
// Editing model: type, then leave the field (blur or Enter) — each field
// saves itself. Clearing a field removes that color's entry.
export function HighlightColorKey({ bookId }: { bookId: string }) {
  const { data, mutate } = useSWR<{ key: ColorKeyMap }>(
    `/api/highlight-key?bookId=${encodeURIComponent(bookId)}`,
    fetcher,
  );
  const key = data?.key ?? {};
  // Local drafts overlay the saved map while a field is being edited; a
  // field with no draft shows the saved label.
  const [drafts, setDrafts] = useState<Partial<Record<HighlightColor, string>>>(
    {},
  );

  async function save(color: HighlightColor) {
    const draft = drafts[color];
    if (draft === undefined) return;
    const trimmed = draft.trim();
    setDrafts((d) => {
      const next = { ...d };
      delete next[color];
      return next;
    });
    if (trimmed === (key[color] ?? "")) return;
    const r = await fetch("/api/highlight-key", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bookId, color, label: trimmed }),
    });
    if (r.ok) {
      const body = (await r.json()) as { key: ColorKeyMap };
      mutate(body, false);
    }
  }

  return (
    <div className="space-y-2">
      <p className="text-xs text-zinc-600">
        Color key — give each highlight color a meaning for this book. The
        reader shows the key while highlighting, and the flashcard export
        groups cards by it.
      </p>
      <div className="grid grid-cols-1 gap-x-6 gap-y-1.5 sm:grid-cols-2">
        {HIGHLIGHT_ORDER.map((c) => (
          <label key={c} className="flex items-center gap-2.5">
            <span
              aria-hidden
              className="h-3.5 w-3.5 shrink-0 rounded-full ring-1 ring-white/10"
              style={{ background: HIGHLIGHT_COLORS[c].swatch }}
            />
            <input
              type="text"
              value={drafts[c] ?? key[c] ?? ""}
              onChange={(e) =>
                setDrafts((d) => ({ ...d, [c]: e.target.value }))
              }
              onBlur={() => save(c)}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.currentTarget.blur();
              }}
              maxLength={60}
              placeholder={`${HIGHLIGHT_COLORS[c].label} means…`}
              aria-label={`Meaning of ${HIGHLIGHT_COLORS[c].label} highlights`}
              className="w-full rounded border border-transparent bg-transparent px-2 py-1 text-xs text-zinc-300 placeholder:text-zinc-700 transition-colors hover:border-zinc-800 focus:border-zinc-700 focus:bg-zinc-900/50 focus:outline-none"
            />
          </label>
        ))}
      </div>
    </div>
  );
}
