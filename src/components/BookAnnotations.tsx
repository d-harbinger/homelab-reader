"use client";

import { useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import { BookOpen, Pencil, Plus, Trash2, X } from "lucide-react";
import { HIGHLIGHT_COLORS, type HighlightColor } from "@/lib/highlight-colors";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface Anchor {
  type: string;
  cfi?: string;
  page?: number;
}
interface StoredHighlight {
  id: string;
  color: HighlightColor;
  text: string;
  anchor: Anchor;
}
interface StoredNote {
  id: string;
  body: string;
  anchor: Anchor;
  context: string | null;
}

// Per-book annotations view for the book detail page — readable outside
// the reader. Lists freeform book notes (not tied to a passage) and every
// highlight, with any note attached to it. Freeform notes can be added,
// edited, and deleted here; passage notes are edited inline too.
export function BookAnnotations({ bookId }: { bookId: string }) {
  const { data: hData, mutate: mutateH } = useSWR<{
    highlights: StoredHighlight[];
  }>(`/api/highlights?bookId=${encodeURIComponent(bookId)}`, fetcher);
  const { data: nData, mutate: mutateN } = useSWR<{ notes: StoredNote[] }>(
    `/api/notes?bookId=${encodeURIComponent(bookId)}`,
    fetcher,
  );

  const highlights = hData?.highlights ?? [];
  const notes = nData?.notes ?? [];

  // A note belongs to a highlight when their CFIs match; everything else
  // (notably anchor.type === "book") is a freeform book note.
  const noteForHighlight = (h: StoredHighlight) =>
    notes.find((n) => n.anchor.cfi && n.anchor.cfi === h.anchor.cfi) ?? null;
  const freeformNotes = notes.filter(
    (n) => !highlights.some((h) => h.anchor.cfi && h.anchor.cfi === n.anchor.cfi),
  );

  async function addFreeformNote(body: string) {
    await fetch("/api/notes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bookId, anchor: { type: "book" }, body }),
    });
    mutateN();
  }
  async function saveNote(id: string, body: string) {
    await fetch(`/api/notes/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body }),
    });
    mutateN();
  }
  async function deleteNote(id: string) {
    await fetch(`/api/notes/${id}`, { method: "DELETE" });
    mutateN();
  }
  async function deleteHighlight(id: string) {
    await fetch(`/api/highlights/${id}`, { method: "DELETE" });
    mutateH();
  }

  const total = highlights.length + freeformNotes.length;

  return (
    <section className="space-y-5 border-t border-zinc-900 pt-6">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-xs uppercase tracking-wider text-zinc-500">
          Notes &amp; highlights
          {total > 0 && <span className="ml-2 text-zinc-700">{total}</span>}
        </h2>
        <Link
          href={`/books/${bookId}/read`}
          className="inline-flex items-center gap-1.5 text-xs text-zinc-500 transition-colors hover:text-zinc-200"
        >
          <BookOpen size={13} />
          Open in reader
        </Link>
      </div>

      <NoteComposer onAdd={addFreeformNote} />

      {freeformNotes.length > 0 && (
        <div className="space-y-2">
          {freeformNotes.map((n) => (
            <NoteRow
              key={n.id}
              body={n.body}
              onSave={(b) => saveNote(n.id, b)}
              onDelete={() => deleteNote(n.id)}
            />
          ))}
        </div>
      )}

      {highlights.length > 0 && (
        <div className="space-y-3">
          {highlights.map((h) => {
            const note = noteForHighlight(h);
            return (
              <div
                key={h.id}
                className="space-y-2 rounded-lg border border-zinc-900 bg-zinc-950 p-3"
              >
                <div className="flex items-start justify-between gap-2">
                  <p
                    className="text-sm leading-snug text-zinc-200"
                    style={{
                      borderLeft: `3px solid ${HIGHLIGHT_COLORS[h.color].swatch}`,
                      paddingLeft: 10,
                    }}
                  >
                    {h.text}
                  </p>
                  <button
                    onClick={() => deleteHighlight(h.id)}
                    aria-label="Delete highlight"
                    title="Delete highlight"
                    className="shrink-0 rounded p-1 text-zinc-600 transition-colors hover:bg-zinc-900 hover:text-red-400"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
                {note ? (
                  <NoteRow
                    body={note.body}
                    onSave={(b) => saveNote(note.id, b)}
                    onDelete={() => deleteNote(note.id)}
                  />
                ) : (
                  <AttachNote
                    onAdd={(b) =>
                      fetch("/api/notes", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                          bookId,
                          anchor: h.anchor,
                          body: b,
                          context: h.text.slice(0, 200),
                        }),
                      }).then(() => mutateN())
                    }
                  />
                )}
              </div>
            );
          })}
        </div>
      )}

      {total === 0 && (
        <p className="text-sm text-zinc-600">
          No notes yet. Add a note above, or highlight passages while reading.
        </p>
      )}
    </section>
  );
}

// Always-visible composer for a new freeform book note.
function NoteComposer({ onAdd }: { onAdd: (body: string) => void }) {
  const [body, setBody] = useState("");
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const v = body.trim();
        if (!v) return;
        onAdd(v);
        setBody("");
      }}
      className="flex items-start gap-2"
    >
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="Add a note about this book…"
        rows={2}
        className="flex-1 resize-y rounded-md border border-zinc-800 bg-zinc-900/50 px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-600 focus:border-amber-500/60 focus:outline-none focus:ring-1 focus:ring-amber-500/30"
      />
      <button
        type="submit"
        disabled={!body.trim()}
        className="inline-flex items-center gap-1.5 rounded-md bg-zinc-800 px-3 py-2 text-xs font-medium text-zinc-200 transition-colors hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-40"
      >
        <Plus size={14} />
        Add
      </button>
    </form>
  );
}

// A single note: read view with edit/delete, switching to a textarea on edit.
function NoteRow({
  body,
  onSave,
  onDelete,
}: {
  body: string;
  onSave: (body: string) => void;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(body);

  if (editing) {
    return (
      <div className="space-y-2">
        <textarea
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={3}
          className="block w-full resize-y rounded-md border border-zinc-800 bg-zinc-900/50 px-3 py-2 text-sm text-zinc-200 focus:border-amber-500/60 focus:outline-none focus:ring-1 focus:ring-amber-500/30"
        />
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              const v = draft.trim();
              if (v) onSave(v);
              setEditing(false);
            }}
            className="rounded-md bg-amber-500/90 px-3 py-1 text-xs font-medium text-zinc-950 transition-colors hover:bg-amber-400"
          >
            Save
          </button>
          <button
            onClick={() => {
              setDraft(body);
              setEditing(false);
            }}
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-zinc-500 transition-colors hover:text-zinc-200"
          >
            <X size={13} />
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="group flex items-start justify-between gap-2 rounded-md bg-zinc-900/40 px-3 py-2">
      <p className="whitespace-pre-wrap text-sm leading-relaxed text-zinc-300">
        {body}
      </p>
      <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
        <button
          onClick={() => {
            setDraft(body);
            setEditing(true);
          }}
          aria-label="Edit note"
          className="rounded p-1 text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
        >
          <Pencil size={13} />
        </button>
        <button
          onClick={onDelete}
          aria-label="Delete note"
          className="rounded p-1 text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-red-400"
        >
          <Trash2 size={13} />
        </button>
      </div>
    </div>
  );
}

// Compact "add note" affordance shown under a highlight that has none.
function AttachNote({ onAdd }: { onAdd: (body: string) => void }) {
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState("");
  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="text-xs text-zinc-500 transition-colors hover:text-zinc-200"
      >
        + Add note
      </button>
    );
  }
  return (
    <div className="space-y-2">
      <textarea
        autoFocus
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={2}
        placeholder="Note on this passage…"
        className="block w-full resize-y rounded-md border border-zinc-800 bg-zinc-900/50 px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-600 focus:border-amber-500/60 focus:outline-none focus:ring-1 focus:ring-amber-500/30"
      />
      <div className="flex items-center gap-2">
        <button
          onClick={() => {
            const v = body.trim();
            if (v) onAdd(v);
            setOpen(false);
            setBody("");
          }}
          className="rounded-md bg-amber-500/90 px-3 py-1 text-xs font-medium text-zinc-950 transition-colors hover:bg-amber-400"
        >
          Save
        </button>
        <button
          onClick={() => {
            setOpen(false);
            setBody("");
          }}
          className="rounded-md px-2 py-1 text-xs text-zinc-500 transition-colors hover:text-zinc-200"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
