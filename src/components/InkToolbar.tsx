"use client";

import { Eraser, Highlighter, PenLine, Undo2 } from "lucide-react";
import {
  HIGHLIGHTER_COLORS,
  HIGHLIGHTER_WIDTHS,
  INK_COLORS,
  INK_OPACITIES,
  INK_WIDTHS,
  type InkKind,
} from "@/lib/ink";

interface Props {
  tool: InkKind;
  color: string;
  width: number;
  opacity: number;
  erasing: boolean;
  canUndo: boolean;
  onTool: (t: InkKind) => void;
  onColor: (c: string) => void;
  onWidth: (w: number) => void;
  onOpacity: (o: number) => void;
  onToggleErase: () => void;
  onUndo: () => void;
}

// The freehand tray. Mirrors the reader's dark chrome; appears only while the
// Draw tool is active. It carries two instruments — a Pen and a Highlighter —
// that swap the palette and nib set: the pen is opaque with an opacity picker,
// the highlighter is broad and translucent (multiply blend) with no opacity
// picker, because a highlighter has one fixed see-through level.
export function InkToolbar({
  tool,
  color,
  width,
  opacity,
  erasing,
  canUndo,
  onTool,
  onColor,
  onWidth,
  onOpacity,
  onToggleErase,
  onUndo,
}: Props) {
  const isPen = tool === "pen";
  const colors = isPen ? INK_COLORS : HIGHLIGHTER_COLORS;
  const widths = isPen ? INK_WIDTHS : HIGHLIGHTER_WIDTHS;

  const tab = (t: InkKind, label: string, Icon: typeof PenLine) => (
    <button
      onClick={() => onTool(t)}
      aria-pressed={tool === t && !erasing}
      title={label}
      className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs transition-colors ${
        tool === t && !erasing
          ? "border-amber-500 bg-amber-500/15 text-amber-400"
          : "border-zinc-800 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200"
      }`}
    >
      <Icon size={14} />
      {label}
    </button>
  );

  return (
    <div className="flex items-center justify-center gap-5 overflow-x-auto border-b border-zinc-900 bg-zinc-900/60 px-4 py-2">
      <div className="flex flex-none items-center gap-1.5">
        {tab("pen", "Pen", PenLine)}
        {tab("highlighter", "Highlighter", Highlighter)}
      </div>

      <div className="flex flex-none items-center gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
          Color
        </span>
        <div className="flex items-center gap-1.5">
          {colors.map((c) => (
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
          {widths.map((w) => (
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

      {isPen && (
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
      )}

      <div className="flex flex-none items-center gap-2">
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
