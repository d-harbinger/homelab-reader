"use client";

import { ZoomIn, ZoomOut, BookOpen, ScrollText } from "lucide-react";

interface Props {
  fontPercent: number;
  onFontStep: (delta: number) => void;
  mode: "paginated" | "scrolled";
  onModeChange: (mode: "paginated" | "scrolled") => void;
  zoomLabel?: string;
}

// Shared reader-chrome toolbar. Stays minimal — quiet bookstore feel —
// but visible at a glance because reading-position controls are the one
// thing you want to grab quickly.
export function ReaderToolbar({
  fontPercent,
  onFontStep,
  mode,
  onModeChange,
  zoomLabel,
}: Props) {
  return (
    <div className="flex items-center gap-1">
      <button
        onClick={() => onFontStep(-1)}
        aria-label="Smaller"
        className="rounded p-1.5 text-zinc-500 transition-colors hover:bg-zinc-900 hover:text-zinc-200"
      >
        <ZoomOut size={14} />
      </button>
      <span className="min-w-[3ch] text-center text-xs tabular-nums text-zinc-500">
        {zoomLabel ?? `${fontPercent}%`}
      </span>
      <button
        onClick={() => onFontStep(1)}
        aria-label="Larger"
        className="rounded p-1.5 text-zinc-500 transition-colors hover:bg-zinc-900 hover:text-zinc-200"
      >
        <ZoomIn size={14} />
      </button>

      <span className="mx-2 h-4 w-px bg-zinc-800" aria-hidden />

      <button
        onClick={() => onModeChange("paginated")}
        aria-label="Paginated"
        aria-pressed={mode === "paginated"}
        className={`rounded p-1.5 transition-colors ${
          mode === "paginated"
            ? "bg-zinc-800 text-zinc-100"
            : "text-zinc-500 hover:bg-zinc-900 hover:text-zinc-200"
        }`}
      >
        <BookOpen size={14} />
      </button>
      <button
        onClick={() => onModeChange("scrolled")}
        aria-label="Continuous scroll"
        aria-pressed={mode === "scrolled"}
        className={`rounded p-1.5 transition-colors ${
          mode === "scrolled"
            ? "bg-zinc-800 text-zinc-100"
            : "text-zinc-500 hover:bg-zinc-900 hover:text-zinc-200"
        }`}
      >
        <ScrollText size={14} />
      </button>
    </div>
  );
}

// Tiny localStorage-backed setting helper. Keys namespaced so they don't
// collide with other apps on the same origin.
export function readSetting<T extends string | number>(
  key: string,
  fallback: T,
): T {
  if (typeof window === "undefined") return fallback;
  const raw = window.localStorage.getItem(`homelab-reader.${key}`);
  if (raw == null) return fallback;
  if (typeof fallback === "number") {
    const n = parseInt(raw, 10);
    return (isFinite(n) ? n : fallback) as T;
  }
  return raw as T;
}

export function writeSetting(key: string, value: string | number) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(`homelab-reader.${key}`, String(value));
}
