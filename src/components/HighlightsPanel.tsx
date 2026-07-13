"use client";

import { useEffect, useRef, useState } from "react";
import { X, Trash2, MessageSquarePlus } from "lucide-react";
import {
  HIGHLIGHT_COLORS,
  HIGHLIGHT_ORDER,
  type HighlightColor,
} from "@/lib/highlight-colors";
import { notesByHighlight } from "@/lib/annotations";

export interface PanelHighlight {
  id: string;
  color: HighlightColor;
  text: string;
  // cfi for EPUB anchors, page for PDF anchors — both optional so the one
  // reader shape covers both formats. progression (0..1 reading position) rides
  // along on synced text-quote anchors that haven't resolved to a CFI yet, so an
  // unresolved highlight can still jump by percentage (Phase C P2).
  anchor: { type: string; cfi?: string; page?: number; progression?: number };
}

export interface PanelNote {
  id: string;
  body: string;
  anchor: { type: string; cfi?: string; page?: number };
  // Structural FK to the highlight this note annotates. PDF highlights have no
  // cfi, so their notes must pair here rather than by anchor string.
  highlightId?: string | null;
}

interface Props {
  open: boolean;
  onClose: () => void;
  highlights: PanelHighlight[];
  notes: PanelNote[];
  // Navigate the reader to this highlight's location.
  onJump: (highlight: PanelHighlight) => void;
  onColorChange: (id: string, color: HighlightColor) => void;
  onDelete: (id: string) => void;
  // Create OR update the note whose anchor matches `highlight.anchor.cfi`.
  // Component passes null body to delete a previously-saved note.
  onNoteSave: (
    highlight: PanelHighlight,
    body: string,
    existingNoteId: string | null,
  ) => void;
  onNoteDelete: (noteId: string) => void;
}

// Right-side slide-in panel. Lists all highlights for the book; each one
// can have a note attached inline. Notes match the highlight by CFI so
// the schema doesn't need a foreign key — a future Note.highlightId
// column would tighten this but isn't required for the UI.
export function HighlightsPanel({
  open,
  onClose,
  highlights,
  notes,
  onJump,
  onColorChange,
  onDelete,
  onNoteSave,
  onNoteDelete,
}: Props) {
  if (!open) return null;
  // Shared CFI-matching rule (see @/lib/annotations) — same rule the book-detail
  // annotations view uses, so the two surfaces can't drift apart.
  const notesForHighlight = notesByHighlight(highlights, notes);
  return (
    <aside
      className="fixed right-0 top-0 z-40 flex h-full w-full max-w-[380px] flex-col border-l border-zinc-900 bg-zinc-950/95 backdrop-blur"
      onClick={(e) => e.stopPropagation()}
    >
      <header className="flex items-center justify-between gap-3 border-b border-zinc-900 px-4 py-3">
        <div>
          <h2 className="text-sm font-medium text-zinc-100">
            Highlights & notes
          </h2>
          <p className="text-xs text-zinc-600">
            {highlights.length}
            {highlights.length === 1 ? " highlight" : " highlights"}
          </p>
        </div>
        <button
          aria-label="Close panel"
          onClick={onClose}
          className="rounded p-1.5 text-zinc-500 transition-colors hover:bg-zinc-900 hover:text-zinc-200"
        >
          <X size={16} />
        </button>
      </header>

      <div className="scroll-slim flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {highlights.length === 0 && (
          <p className="text-sm text-zinc-600">
            Select text in the book to start highlighting.
          </p>
        )}
        {highlights.map((h) => {
          const note = notesForHighlight.get(h.id) ?? null;
          return (
            <HighlightCard
              key={h.id}
              highlight={h}
              note={note ?? null}
              onJump={() => onJump(h)}
              onColorChange={(c) => onColorChange(h.id, c)}
              onDelete={() => onDelete(h.id)}
              onNoteSave={(body, existingId) =>
                onNoteSave(h, body, existingId)
              }
              onNoteDelete={(id) => onNoteDelete(id)}
            />
          );
        })}
      </div>
    </aside>
  );
}

function HighlightCard({
  highlight,
  note,
  onJump,
  onColorChange,
  onDelete,
  onNoteSave,
  onNoteDelete,
}: {
  highlight: PanelHighlight;
  note: PanelNote | null;
  onJump: () => void;
  onColorChange: (c: HighlightColor) => void;
  onDelete: () => void;
  onNoteSave: (body: string, existingNoteId: string | null) => void;
  onNoteDelete: (id: string) => void;
}) {
  const [draft, setDraft] = useState(note?.body ?? "");
  const [showNote, setShowNote] = useState(!!note);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Keep draft in sync if the note arrives or changes from outside.
  useEffect(() => {
    setDraft(note?.body ?? "");
  }, [note?.id, note?.body]);

  // Debounced auto-save: typing stops for 600ms → save.
  useEffect(() => {
    if (!showNote) return;
    if (draft === (note?.body ?? "")) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      if (draft.trim() === "" && note) {
        onNoteDelete(note.id);
      } else if (draft.trim() !== "") {
        onNoteSave(draft, note?.id ?? null);
      }
    }, 600);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, showNote]);

  return (
    <div className="space-y-2 rounded-lg border border-zinc-900 bg-zinc-950 p-3">
      <button
        onClick={onJump}
        className="block w-full text-left"
        title="Jump to this passage"
      >
        <p
          className="text-sm leading-snug text-zinc-200"
          style={{
            borderLeft: `3px solid ${HIGHLIGHT_COLORS[highlight.color].swatch}`,
            paddingLeft: 10,
          }}
        >
          {highlight.text}
        </p>
      </button>

      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          {HIGHLIGHT_ORDER.map((c) => (
            <button
              key={c}
              aria-label={HIGHLIGHT_COLORS[c].label}
              onClick={() => onColorChange(c)}
              className={`h-4 w-4 rounded-full ring-2 transition-transform hover:scale-110 ${
                c === highlight.color ? "ring-zinc-100" : "ring-zinc-800"
              }`}
              style={{ background: HIGHLIGHT_COLORS[c].swatch }}
            />
          ))}
        </div>
        <div className="flex items-center gap-1">
          {!showNote && !note && (
            <button
              onClick={() => setShowNote(true)}
              aria-label="Add note"
              title="Add note"
              className="rounded p-1 text-zinc-500 transition-colors hover:bg-zinc-900 hover:text-zinc-200"
            >
              <MessageSquarePlus size={14} />
            </button>
          )}
          <button
            onClick={onDelete}
            aria-label="Delete highlight"
            title="Delete highlight"
            className="rounded p-1 text-zinc-500 transition-colors hover:bg-zinc-900 hover:text-red-400"
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      {(showNote || note) && (
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Add a note…"
          className="mt-1 block w-full resize-y rounded border border-zinc-800 bg-zinc-900/50 px-2 py-1.5 text-xs leading-relaxed text-zinc-200 placeholder:text-zinc-600 focus:border-amber-500/60 focus:outline-none focus:ring-1 focus:ring-amber-500/30"
          rows={3}
        />
      )}
    </div>
  );
}
