"use client";

import { Trash2 } from "lucide-react";
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
  onPick,
  onDelete,
}: {
  x: number;
  y: number;
  activeColor: HighlightColor;
  onPick: (c: HighlightColor) => void;
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
        aria-label="Delete highlight"
        onClick={onDelete}
        className="rounded p-1.5 text-zinc-500 transition-colors hover:bg-zinc-900 hover:text-red-400"
      >
        <Trash2 size={14} />
      </button>
    </div>
  );
}
