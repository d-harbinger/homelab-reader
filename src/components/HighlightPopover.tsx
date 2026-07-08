"use client";

import { useState } from "react";
import { StickyNote, Trash2 } from "lucide-react";
import {
  HIGHLIGHT_COLORS,
  HIGHLIGHT_ORDER,
  type HighlightColor,
} from "@/lib/highlight-colors";

// Floating popovers shared by both readers (EPUB + PDF).
//
// - ColorPickerPopover: shown on a fresh text selection; pick a color to save.
// - HighlightMenu: shown on clicking an existing highlight; recolor or delete.
//
// Both position with `fixed` at outer-page (viewport) coordinates the caller
// computes, and stop click propagation so the outside-click dismiss handler in
// the reader doesn't immediately close them.

export function ColorPickerPopover({
  x,
  y,
  onPick,
}: {
  x: number;
  y: number;
  onPick: (c: HighlightColor) => void;
}) {
  return (
    <div
      className="fixed z-50 flex items-center gap-1 rounded-lg border border-zinc-800 bg-zinc-950/95 p-1.5 shadow-2xl shadow-black/60 backdrop-blur"
      style={{
        left: Math.max(8, x - 80),
        top: Math.max(8, y - 48),
      }}
      onClick={(e) => e.stopPropagation()}
    >
      {HIGHLIGHT_ORDER.map((c) => (
        <button
          key={c}
          aria-label={HIGHLIGHT_COLORS[c].label}
          onClick={() => onPick(c)}
          className="h-7 w-7 rounded-full ring-1 ring-zinc-700 transition-transform hover:scale-110"
          style={{ background: HIGHLIGHT_COLORS[c].swatch }}
        />
      ))}
    </div>
  );
}

export function HighlightMenu({
  x,
  y,
  activeColor,
  hasNote,
  onPick,
  onAddNote,
  onDelete,
}: {
  x: number;
  y: number;
  activeColor: HighlightColor;
  hasNote?: boolean;
  onPick: (c: HighlightColor) => void;
  onAddNote: () => void;
  onDelete: () => void;
}) {
  return (
    <div
      className="fixed z-50 flex items-center gap-1 rounded-lg border border-zinc-800 bg-zinc-950/95 p-1.5 shadow-2xl shadow-black/60 backdrop-blur"
      style={{
        left: Math.max(8, x - 100),
        top: Math.max(8, y - 48),
      }}
      onClick={(e) => e.stopPropagation()}
    >
      {HIGHLIGHT_ORDER.map((c) => (
        <button
          key={c}
          aria-label={HIGHLIGHT_COLORS[c].label}
          onClick={() => onPick(c)}
          className={`h-7 w-7 rounded-full ring-2 transition-transform hover:scale-110 ${
            c === activeColor ? "ring-zinc-100" : "ring-zinc-700"
          }`}
          style={{ background: HIGHLIGHT_COLORS[c].swatch }}
        />
      ))}
      <span className="mx-1 h-5 w-px bg-zinc-800" aria-hidden />
      <button
        aria-label={hasNote ? "Edit note" : "Add note"}
        title={hasNote ? "Edit note" : "Add note"}
        onClick={onAddNote}
        className={`rounded p-1.5 transition-colors hover:bg-zinc-900 ${
          hasNote
            ? "text-amber-400 hover:text-amber-300"
            : "text-zinc-500 hover:text-zinc-200"
        }`}
      >
        <StickyNote size={14} />
      </button>
      <button
        aria-label="Delete highlight"
        onClick={onDelete}
        className="rounded p-1.5 text-zinc-500 transition-colors hover:bg-zinc-900 hover:text-red-400"
      >
        <Trash2 size={14} />
      </button>
    </div>
  );
}

// A small note editor floated at the highlight. Opened from the highlight
// menu's note action; pre-filled when the highlight already has a note.
export function NoteEditorPopover({
  x,
  y,
  initialBody,
  onSave,
  onCancel,
}: {
  x: number;
  y: number;
  initialBody: string;
  onSave: (body: string) => void;
  onCancel: () => void;
}) {
  const [body, setBody] = useState(initialBody);
  return (
    <div
      className="fixed z-50 w-72 rounded-lg border border-zinc-800 bg-zinc-950/95 p-2 shadow-2xl shadow-black/60 backdrop-blur"
      style={{ left: Math.max(8, x - 140), top: Math.max(8, y - 8) }}
      onClick={(e) => e.stopPropagation()}
    >
      <textarea
        autoFocus
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="Add a note…"
        rows={4}
        className="w-full resize-y rounded border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-zinc-600 focus:outline-none"
      />
      <div className="mt-1.5 flex items-center justify-end gap-2">
        <button
          onClick={onCancel}
          className="rounded px-2 py-1 text-xs text-zinc-400 transition-colors hover:text-zinc-200"
        >
          Cancel
        </button>
        <button
          onClick={() => onSave(body)}
          disabled={!body.trim()}
          className="rounded bg-amber-500/90 px-2.5 py-1 text-xs font-medium text-zinc-950 transition-colors hover:bg-amber-400 disabled:opacity-40"
        >
          Save
        </button>
      </div>
    </div>
  );
}
