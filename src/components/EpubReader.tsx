"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ChevronLeft, ChevronRight } from "lucide-react";
import {
  ReaderToolbar,
  readSetting,
  writeSetting,
} from "./ReaderToolbar";

interface Props {
  bookId: string;
  title: string;
  fileUrl: string;
  initialCfi: string | null;
}

// Loose epub.js types — the lib's own types are wide-open Any anyway.
interface RenditionLike {
  display(target?: string | undefined): Promise<unknown>;
  next(): Promise<unknown>;
  prev(): Promise<unknown>;
  flow(value: string): void;
  destroy(): void;
  on(event: string, fn: (...args: unknown[]) => void): void;
  off(event: string, fn: (...args: unknown[]) => void): void;
  themes: {
    register(name: string, styles: Record<string, Record<string, string>>): void;
    select(name: string): void;
    fontSize(value: string): void;
  };
}
interface BookLike {
  ready: Promise<unknown>;
  destroy(): void;
  renderTo(target: HTMLElement, opts: Record<string, unknown>): RenditionLike;
  locations: {
    generate(charsPerLocation: number): Promise<unknown>;
    percentageFromCfi(cfi: string): number;
    length(): number;
  };
}

const FONT_STEPS = [80, 90, 100, 110, 120, 140, 160, 180, 200];

function stepFont(current: number, delta: number): number {
  const idx = FONT_STEPS.indexOf(current);
  const target = Math.max(0, Math.min(FONT_STEPS.length - 1, idx + delta));
  return FONT_STEPS[target] ?? 100;
}

export function EpubReader({ bookId, title, fileUrl, initialCfi }: Props) {
  const viewerRef = useRef<HTMLDivElement>(null);
  const renditionRef = useRef<RenditionLike | null>(null);
  const bookRef = useRef<BookLike | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [ready, setReady] = useState(false);
  const [percent, setPercent] = useState(0);
  const [mode, setMode] = useState<"paginated" | "scrolled">(() =>
    readSetting<string>("epub.mode", "paginated") === "scrolled"
      ? "scrolled"
      : "paginated",
  );
  const [fontPercent, setFontPercent] = useState<number>(() =>
    readSetting<number>("epub.font", 100),
  );

  // (Re)mount the rendition whenever the chosen reading mode changes.
  // epubjs supports rendition.flow() at runtime, but switching from
  // paginated to scrolled-doc after mount leaves stale DOM in the
  // iframe. Recreating the rendition is cheaper than reasoning about
  // its internal state.
  useEffect(() => {
    let cancelled = false;
    const viewer = viewerRef.current;
    if (!viewer) return;

    (async () => {
      const { default: ePub } = await import("epubjs");
      if (cancelled) return;

      // ArrayBuffer input bypasses the URL-extension sniff that would
      // otherwise make epubjs treat /api/books/[id]/file as an unzipped
      // directory.
      const response = await fetch(fileUrl);
      if (!response.ok || cancelled) return;
      const buffer = await response.arrayBuffer();
      if (cancelled) return;

      const book = ePub(buffer) as unknown as BookLike;
      bookRef.current = book;

      const rendition = book.renderTo(viewer, {
        width: "100%",
        height: "100%",
        spread: "auto",
        flow: mode === "scrolled" ? "scrolled-doc" : "paginated",
        // In scroll mode let the viewer pane grow with content so the
        // browser handles vertical scroll natively.
        manager: mode === "scrolled" ? "continuous" : "default",
      });
      renditionRef.current = rendition;

      rendition.themes.register("homelab-dark", {
        body: {
          color: "#e4e4e7",
          background: "#09090b",
          "font-family":
            '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, system-ui, sans-serif',
          "line-height": "1.6",
        },
        a: { color: "#fbbf24" },
        "h1, h2, h3, h4, h5, h6": { color: "#fafafa" },
      });
      rendition.themes.select("homelab-dark");
      rendition.themes.fontSize(`${fontPercent}%`);

      await rendition.display(initialCfi ?? undefined);
      if (cancelled) return;
      setReady(true);

      book.ready
        .then(() => book.locations.generate(1024))
        .catch(() => {
          /* best-effort */
        });

      const onRelocated = (...args: unknown[]) => {
        const location = args[0] as
          | { start?: { cfi?: string; percentage?: number } }
          | undefined;
        const cfi = location?.start?.cfi;
        const pct = location?.start?.percentage;
        if (typeof pct === "number" && isFinite(pct)) setPercent(pct);
        if (!cfi) return;

        if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
        saveTimerRef.current = setTimeout(() => {
          fetch("/api/progress", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              bookId,
              anchor: { type: "epub-cfi", cfi },
              percent: typeof pct === "number" ? pct : undefined,
            }),
          }).catch(() => {
            /* transient */
          });
        }, 800);
      };

      rendition.on("relocated", onRelocated);

      const onKey = (e: KeyboardEvent) => {
        if (mode === "paginated") {
          if (
            e.key === "ArrowRight" ||
            e.key === " " ||
            e.key === "PageDown"
          ) {
            rendition.next();
          } else if (e.key === "ArrowLeft" || e.key === "PageUp") {
            rendition.prev();
          }
        }
        // In scroll mode the browser handles ArrowDown/Up natively;
        // don't fight it.
      };
      window.addEventListener("keydown", onKey);
      rendition.on("keydown", (...args: unknown[]) =>
        onKey(args[0] as KeyboardEvent),
      );

      return () => {
        window.removeEventListener("keydown", onKey);
      };
    })();

    return () => {
      cancelled = true;
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      renditionRef.current?.destroy?.();
      bookRef.current?.destroy?.();
      renditionRef.current = null;
      bookRef.current = null;
    };
    // mode changes trigger a rendition rebuild; font size doesn't
    // (handled by a separate effect below) so it stays out of deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookId, fileUrl, initialCfi, mode]);

  // Font size — applied without rebuilding the rendition.
  useEffect(() => {
    renditionRef.current?.themes.fontSize(`${fontPercent}%`);
    writeSetting("epub.font", fontPercent);
  }, [fontPercent]);

  // Persist mode separately so the rebuild above runs before we save.
  useEffect(() => {
    writeSetting("epub.mode", mode);
  }, [mode]);

  return (
    <div className="fixed inset-0 flex flex-col bg-zinc-950 text-zinc-100">
      <header className="flex items-center justify-between gap-4 border-b border-zinc-900 px-4 py-2">
        <Link
          href={`/books/${bookId}`}
          className="inline-flex items-center gap-2 text-xs text-zinc-500 hover:text-zinc-200 transition-colors"
        >
          <ArrowLeft size={14} />
          <span className="hidden sm:inline">{title}</span>
        </Link>
        <ReaderToolbar
          fontPercent={fontPercent}
          onFontStep={(delta) =>
            setFontPercent((p) => stepFont(p, delta))
          }
          mode={mode}
          onModeChange={setMode}
        />
        <div className="text-xs text-zinc-600 tabular-nums">
          {ready ? `${Math.round(percent * 100)}%` : "Loading…"}
        </div>
      </header>

      <div className="relative flex-1 overflow-hidden">
        <div ref={viewerRef} className="h-full w-full" />

        {mode === "paginated" && (
          <>
            <button
              aria-label="Previous page"
              onClick={() => renditionRef.current?.prev()}
              className="absolute left-0 top-0 z-10 flex h-full w-20 items-center justify-start pl-3 text-zinc-700 opacity-0 transition-opacity hover:bg-gradient-to-r hover:from-zinc-900/50 hover:opacity-100"
            >
              <ChevronLeft size={28} />
            </button>
            <button
              aria-label="Next page"
              onClick={() => renditionRef.current?.next()}
              className="absolute right-0 top-0 z-10 flex h-full w-20 items-center justify-end pr-3 text-zinc-700 opacity-0 transition-opacity hover:bg-gradient-to-l hover:from-zinc-900/50 hover:opacity-100"
            >
              <ChevronRight size={28} />
            </button>
          </>
        )}
      </div>

      <div className="h-0.5 w-full bg-zinc-900">
        <div
          className="h-full bg-amber-500/70 transition-[width] duration-200"
          style={{ width: `${(percent * 100).toFixed(2)}%` }}
        />
      </div>
    </div>
  );
}
