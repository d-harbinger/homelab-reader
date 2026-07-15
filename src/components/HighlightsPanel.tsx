"use client";

import { useEffect, useRef, useState } from "react";
import { X, Trash2, MessageSquarePlus } from "lucide-react";
import {
  HIGHLIGHT_COLORS,
  HIGHLIGHT_ORDER,
  type ColorKeyMap,
  type HighlightColor,
} from "@/lib/highlight-colors";
import { byBookPosition, notesByHighlight } from "@/lib/annotations";
import { readSetting, writeSetting } from "./ReaderToolbar";

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
  // The book's color key (color → meaning), rendered as a legend when any
  // color is labeled. Editing the key lives on the book detail page.
  colorKey?: ColorKeyMap;
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

// Right-side panel. Lists all highlights for the book; each one can have a
// note attached inline. Notes match the highlight by CFI so the schema
// doesn't need a foreign key — a future Note.highlightId column would
// tighten this but isn't required for the UI.
//
// Layout contract: the readers render this as a flex SIBLING of the reading
// surface (inside a `relative flex` row), so opening it pushes the book text
// aside instead of covering it. On phone widths there is no room to push —
// the max-sm classes fall back to overlaying inside that same relative row.
export function HighlightsPanel({
  open,
  onClose,
  highlights,
  notes,
  colorKey,
  onJump,
  onColorChange,
  onDelete,
  onNoteSave,
  onNoteDelete,
}: Props) {
  // Two views of the same list: "In book" = position order (what Calibre and
  // Kindle's Notebook do), "By color" = grouped under the color key's meanings
  // — the panel-shaped view of the same structure the flashcard export emits.
  // Persisted like the readers' other view settings.
  const [sort, setSort] = useState<"book" | "color">(() =>
    readSetting<string>("panel.sort", "book") === "color" ? "color" : "book",
  );
  if (!open) return null;
  // Shared CFI-matching rule (see @/lib/annotations) — same rule the book-detail
  // annotations view uses, so the two surfaces can't drift apart.
  const notesForHighlight = notesByHighlight(highlights, notes);
  const legend = HIGHLIGHT_ORDER.filter((c) => colorKey?.[c]);
  const ordered = byBookPosition(highlights);

  const renderCard = (h: PanelHighlight) => {
    const note = notesForHighlight.get(h.id) ?? null;
    return (
      <HighlightCard
        key={h.id}
        highlight={h}
        note={note ?? null}
        onJump={() => onJump(h)}
        onColorChange={(c) => onColorChange(h.id, c)}
        onDelete={() => onDelete(h.id)}
        onNoteSave={(body, existingId) => onNoteSave(h, body, existingId)}
        onNoteDelete={(id) => onNoteDelete(id)}
      />
    );
  };

  return (
    <aside
      className="z-40 flex h-full w-[380px] shrink-0 flex-col border-l border-zinc-900 bg-zinc-950/95 backdrop-blur max-sm:absolute max-sm:inset-y-0 max-sm:right-0 max-sm:w-full max-sm:max-w-[380px]"
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

      {highlights.length > 0 && (
        <div
          role="group"
          aria-label="Arrange highlights"
          className="flex items-center gap-1 border-b border-zinc-900 px-4 py-2"
        >
          {(
            [
              ["book", "In book"],
              ["color", "By color"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              aria-pressed={sort === value}
              onClick={() => {
                setSort(value);
                writeSetting("panel.sort", value);
              }}
              className={`rounded px-2 py-0.5 text-xs transition-colors ${
                sort === value
                  ? "bg-zinc-800 text-zinc-100"
                  : "text-zinc-500 hover:text-zinc-200"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {/* The legend rides with the flat view only — in the color view the
          group headers already carry the meanings. */}
      {legend.length > 0 && sort === "book" && (
        <div className="flex flex-wrap gap-x-4 gap-y-1.5 border-b border-zinc-900 px-4 py-2.5">
          {legend.map((c) => (
            <span
              key={c}
              className="inline-flex items-center gap-1.5 text-xs text-zinc-400"
            >
              <span
                aria-hidden
                className="h-2.5 w-2.5 rounded-full"
                style={{ background: HIGHLIGHT_COLORS[c].swatch }}
              />
              {colorKey?.[c]}
            </span>
          ))}
        </div>
      )}

      <div className="scroll-slim flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {highlights.length === 0 && (
          <p className="text-sm text-zinc-600">
            Select text in the book to start highlighting.
          </p>
        )}
        {sort === "book"
          ? ordered.map((h) => renderCard(h))
          : HIGHLIGHT_ORDER.map((c) => {
              const group = ordered.filter((h) => h.color === c);
              if (group.length === 0) return null;
              return (
                <div key={c} className="space-y-3">
                  <div className="flex items-center gap-2 pt-1">
                    <span
                      aria-hidden
                      className="h-2.5 w-2.5 rounded-full"
                      style={{ background: HIGHLIGHT_COLORS[c].swatch }}
                    />
                    <span className="text-xs font-medium text-zinc-400">
                      {colorKey?.[c] ?? HIGHLIGHT_COLORS[c].label}
                    </span>
                    <span className="text-xs text-zinc-700">{group.length}</span>
                  </div>
                  {group.map((h) => renderCard(h))}
                </div>
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
