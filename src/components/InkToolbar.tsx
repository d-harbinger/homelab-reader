"use client";

import { Eraser, Undo2 } from "lucide-react";
import { INK_COLORS, INK_OPACITIES, INK_WIDTHS } from "@/lib/ink";

interface Props {
  color: string;
  width: number;
  opacity: number;
  erasing: boolean;
  canUndo: boolean;
  onColor: (c: string) => void;
  onWidth: (w: number) => void;
  onOpacity: (o: number) => void;
  onToggleErase: () => void;
  onUndo: () => void;
}

// The Draw-tool tray. Mirrors the reader's dark chrome; appears only while the
// Draw tool is active.
export function InkToolbar({
  color,
  width,
  opacity,
  erasing,
  canUndo,
  onColor,
  onWidth,
  onOpacity,
  onToggleErase,
  onUndo,
}: Props) {
  return (
    <div className="flex items-center gap-5 overflow-x-auto border-b border-zinc-900 bg-zinc-900/60 px-4 py-2">
      <div className="flex flex-none items-center gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
          Pen
        </span>
        <div className="flex items-center gap-1.5">
          {INK_COLORS.map((c) => (
            <button
              key={c.value}
              aria-label={c.name}
              aria-pressed={c.value === color && !erasing}
              onClick={() => onColor(c.value)}
              className={`h-5 w-5 rounded-full ring-1 ring-white/15 transition-transform hover:scale-110 ${
                c.value === color && !erasing ? "ring-2 ring-zinc-100" : ""
              }`}
              style={{ background: c.value }}
            />
          ))}
        </div>
      </div>

      <div className="flex flex-none items-center gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
          Weight
        </span>
        <div className="flex items-center gap-1.5">
          {INK_WIDTHS.map((w) => (
            <button
              key={w.value}
              aria-label={w.name}
              aria-pressed={w.value === width}
              onClick={() => onWidth(w.value)}
              className={`grid h-6 w-8 place-items-center rounded border transition-colors ${
                w.value === width
                  ? "border-amber-500 bg-amber-500/15"
                  : "border-zinc-800 hover:border-zinc-700"
              }`}
            >
              <span
                className="rounded-full bg-zinc-100"
                style={{ width: w.dot, height: w.dot }}
              />
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-none items-center gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
          Opacity
        </span>
        <div className="flex items-center gap-1.5">
          {INK_OPACITIES.map((o) => (
            <button
              key={o.value}
              aria-label={o.name}
              aria-pressed={o.value === opacity}
              title={o.name}
              onClick={() => onOpacity(o.value)}
              className={`grid h-6 w-8 place-items-center rounded border transition-colors ${
                o.value === opacity
                  ? "border-amber-500 bg-amber-500/15"
                  : "border-zinc-800 hover:border-zinc-700"
              }`}
            >
              <span
                className="h-2.5 w-2.5 rounded-full bg-zinc-100"
                style={{ opacity: o.value }}
              />
            </button>
          ))}
        </div>
      </div>

      <div className="ml-auto flex flex-none items-center gap-2">
        <button
          onClick={onToggleErase}
          aria-pressed={erasing}
          title="Tap a stroke to remove it"
          className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs transition-colors ${
            erasing
              ? "border-amber-500 bg-amber-500/15 text-amber-400"
              : "border-zinc-800 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200"
          }`}
        >
          <Eraser size={14} />
          Eraser
        </button>
        <button
          onClick={onUndo}
          disabled={!canUndo}
          className="inline-flex items-center gap-1.5 rounded-md border border-zinc-800 px-2.5 py-1.5 text-xs text-zinc-400 transition-colors hover:border-zinc-700 hover:text-zinc-200 disabled:opacity-40 disabled:hover:border-zinc-800 disabled:hover:text-zinc-400"
        >
          <Undo2 size={14} />
          Undo
        </button>
      </div>
    </div>
  );
}
