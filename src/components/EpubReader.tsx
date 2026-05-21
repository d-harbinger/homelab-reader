"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ChevronLeft, ChevronRight } from "lucide-react";

interface Props {
  bookId: string;
  title: string;
  fileUrl: string;
  initialCfi: string | null;
}

// We type epub.js loosely — the lib's types are wide-open Any anyway and
// importing them across the client/server boundary in Next is painful.
interface RenditionLike {
  display(target?: string | undefined): Promise<unknown>;
  next(): Promise<unknown>;
  prev(): Promise<unknown>;
  destroy(): void;
  on(event: string, fn: (...args: unknown[]) => void): void;
  off(event: string, fn: (...args: unknown[]) => void): void;
  themes: {
    register(name: string, styles: Record<string, Record<string, string>>): void;
    select(name: string): void;
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

export function EpubReader({ bookId, title, fileUrl, initialCfi }: Props) {
  const viewerRef = useRef<HTMLDivElement>(null);
  const renditionRef = useRef<RenditionLike | null>(null);
  const bookRef = useRef<BookLike | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [ready, setReady] = useState(false);
  const [percent, setPercent] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const viewer = viewerRef.current;
    if (!viewer) return;

    (async () => {
      const { default: ePub } = await import("epubjs");
      if (cancelled) return;

      const book = ePub(fileUrl) as unknown as BookLike;
      bookRef.current = book;

      const rendition = book.renderTo(viewer, {
        width: "100%",
        height: "100%",
        spread: "auto",
        flow: "paginated",
      });
      renditionRef.current = rendition;

      // Quiet reading theme — matches the rest of the app's dark surface
      // so the reader doesn't feel like a different product.
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

      await rendition.display(initialCfi ?? undefined);
      if (cancelled) return;
      setReady(true);

      // Build the locations table in the background so we can compute
      // a real percent. ~1024 chars per location ≈ 1 page; cheap enough
      // to run on every open.
      book.ready
        .then(() => book.locations.generate(1024))
        .catch(() => {
          /* locations are best-effort */
        });

      const onRelocated = (...args: unknown[]) => {
        const location = args[0] as
          | {
              start?: { cfi?: string; percentage?: number };
              atStart?: boolean;
              atEnd?: boolean;
            }
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
            /* offline / transient — next page turn will retry */
          });
        }, 800);
      };

      rendition.on("relocated", onRelocated);

      // Keyboard nav. epub.js renders to an iframe whose document
      // doesn't inherit window keydown listeners by default, so we
      // hook both sides.
      const onKey = (e: KeyboardEvent) => {
        if (e.key === "ArrowRight" || e.key === " " || e.key === "PageDown") {
          rendition.next();
        } else if (e.key === "ArrowLeft" || e.key === "PageUp") {
          rendition.prev();
        }
      };
      window.addEventListener("keydown", onKey);
      rendition.on("keydown", (...args: unknown[]) => onKey(args[0] as KeyboardEvent));

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
  }, [bookId, fileUrl, initialCfi]);

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
        <div className="text-xs text-zinc-600 tabular-nums">
          {ready ? `${Math.round(percent * 100)}%` : "Loading…"}
        </div>
      </header>

      <div className="relative flex-1">
        <div ref={viewerRef} className="h-full w-full" />

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
