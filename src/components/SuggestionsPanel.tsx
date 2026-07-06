"use client";

import { useState } from "react";
import useSWR from "swr";
import { Check, Sparkles, X } from "lucide-react";
import { fetcher } from "@/lib/fetcher";

interface Suggestion {
  id: string;
  source: string;
  confidence: number;
  title: string | null;
  authors: string[];
  publishedYear: number | null;
  publisher: string | null;
  isbn: string | null;
  subjects: string[];
  workKey: string | null;
}

// Enrich-on-import review panel for the book detail page (D3). Lists the
// pending OpenLibrary metadata suggestions stored against this book and lets an
// admin resolve them: Accept fills the book's empty fields (force overwrites),
// Dismiss rejects just that candidate. Rendered only for admins — accepting
// writes the shared catalog row, so review is a curation surface, not a reader
// one. The panel disappears once nothing is pending.
export function SuggestionsPanel({ bookId }: { bookId: string }) {
  const { data, mutate } = useSWR<{ suggestions: Suggestion[] }>(
    `/api/books/${encodeURIComponent(bookId)}/suggestions`,
    fetcher,
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const suggestions = data?.suggestions ?? [];
  if (suggestions.length === 0) return null;

  async function resolve(sid: string, action: "accept" | "dismiss", force = false) {
    setBusy(sid);
    setError(null);
    const res = await fetch(
      `/api/books/${encodeURIComponent(bookId)}/suggestions/${encodeURIComponent(sid)}`,
      action === "accept"
        ? {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ force }),
          }
        : { method: "DELETE" },
    );
    setBusy(null);
    if (!res.ok) {
      setError(
        action === "accept"
          ? "Could not apply the suggestion."
          : "Could not dismiss the suggestion.",
      );
      return;
    }
    await mutate();
    // Accepting writes book columns rendered by the server component (publisher,
    // ISBN, tags) — a client revalidate alone won't refresh those, so reload the
    // page to show the applied metadata.
    if (action === "accept") window.location.reload();
  }

  return (
    <section
      data-testid="suggestions-panel"
      className="space-y-4 rounded-lg border border-amber-500/20 bg-amber-500/[0.03] p-4"
    >
      <div className="flex items-center gap-2">
        <Sparkles size={14} className="text-amber-400/80" />
        <h2 className="text-xs uppercase tracking-wider text-zinc-400">
          Metadata suggestions
          <span className="ml-2 text-zinc-600">{suggestions.length}</span>
        </h2>
      </div>
      <p className="text-xs text-zinc-500">
        Found on import from OpenLibrary. Accepting fills this book&apos;s empty
        fields and adds subjects as tags; existing metadata is kept unless
        overwrite is checked.
      </p>

      {error && <p className="text-xs text-red-400">{error}</p>}

      <div className="space-y-3">
        {suggestions.map((s) => (
          <SuggestionRow
            key={s.id}
            suggestion={s}
            busy={busy === s.id}
            onAccept={(force) => resolve(s.id, "accept", force)}
            onDismiss={() => resolve(s.id, "dismiss")}
          />
        ))}
      </div>
    </section>
  );
}

function SuggestionRow({
  suggestion: s,
  busy,
  onAccept,
  onDismiss,
}: {
  suggestion: Suggestion;
  busy: boolean;
  onAccept: (force: boolean) => void;
  onDismiss: () => void;
}) {
  const [force, setForce] = useState(false);

  const fields: Array<[string, string]> = [];
  if (s.title) fields.push(["Title", s.title]);
  if (s.authors.length > 0) fields.push(["Authors", s.authors.join(", ")]);
  if (s.publisher) fields.push(["Publisher", s.publisher]);
  if (s.publishedYear) fields.push(["Published", String(s.publishedYear)]);
  if (s.isbn) fields.push(["ISBN", s.isbn]);
  if (s.subjects.length > 0) fields.push(["Subjects", s.subjects.join(", ")]);

  return (
    <div className="space-y-3 rounded-md border border-zinc-900 bg-zinc-950 p-3">
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="text-zinc-500">
          {s.source}
          <span className="ml-2 text-zinc-700">
            {Math.round(s.confidence * 100)}% match
          </span>
        </span>
      </div>

      <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-xs sm:grid-cols-2">
        {fields.map(([label, value]) => (
          <div key={label} className="space-y-0.5">
            <dt className="uppercase tracking-wider text-zinc-600">{label}</dt>
            <dd className="break-words text-zinc-200">{value}</dd>
          </div>
        ))}
      </dl>

      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={() => onAccept(force)}
          disabled={busy}
          className="inline-flex items-center gap-1.5 rounded-md bg-amber-500/90 px-3 py-1.5 text-xs font-medium text-zinc-950 transition-colors hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Check size={13} />
          Accept
        </button>
        <button
          onClick={onDismiss}
          disabled={busy}
          className="inline-flex items-center gap-1.5 rounded-md border border-zinc-800 px-3 py-1.5 text-xs text-zinc-300 transition-colors hover:border-zinc-700 hover:text-zinc-100 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <X size={13} />
          Dismiss
        </button>
        <label className="inline-flex cursor-pointer items-center gap-1.5 text-xs text-zinc-500">
          <input
            type="checkbox"
            checked={force}
            onChange={(e) => setForce(e.target.checked)}
            className="h-3.5 w-3.5 rounded border-zinc-700 bg-zinc-900 accent-amber-500"
          />
          Overwrite existing fields
        </label>
      </div>
    </div>
  );
}
