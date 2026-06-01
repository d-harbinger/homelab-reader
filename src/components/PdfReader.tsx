"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import Link from "next/link";
import { ArrowLeft, ChevronLeft, ChevronRight } from "lucide-react";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";
import {
  ReaderToolbar,
  readSetting,
  writeSetting,
} from "./ReaderToolbar";

pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";

interface Props {
  bookId: string;
  title: string;
  fileUrl: string;
  initialPage: number;
  scannerPageCount: number | null;
}

const ZOOM_STEPS = [60, 75, 90, 100, 110, 125, 150, 175, 200, 250];

// Scroll mode renders a WINDOW of pages on each side of the current page and
// leaves the rest as height-estimated spacers. Rendering every page at once
// mounts one full PDF.js canvas + text layer PER PAGE simultaneously, which
// pegs CPU/memory and freezes the browser (and the host) on long PDFs.
const SCROLL_WINDOW = 3;

function stepZoom(current: number, delta: number): number {
  const idx = ZOOM_STEPS.indexOf(current);
  const target = Math.max(0, Math.min(ZOOM_STEPS.length - 1, idx + delta));
  return ZOOM_STEPS[target] ?? 100;
}

export function PdfReader({
  bookId,
  title,
  fileUrl,
  initialPage,
  scannerPageCount,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const pageRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const [width, setWidth] = useState(0);
  const [page, setPage] = useState(initialPage);
  const [numPages, setNumPages] = useState(scannerPageCount ?? 0);
  const [loaded, setLoaded] = useState(false);
  const [mode, setMode] = useState<"paginated" | "scrolled">(() =>
    readSetting<string>("pdf.mode", "paginated") === "scrolled"
      ? "scrolled"
      : "paginated",
  );
  const [zoom, setZoom] = useState<number>(() =>
    readSetting<number>("pdf.zoom", 100),
  );
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Fit-to-width baseline. The user's zoom slider is applied multiplicatively.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const measure = () => setWidth(el.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Persist preferences.
  useEffect(() => writeSetting("pdf.mode", mode), [mode]);
  useEffect(() => writeSetting("pdf.zoom", zoom), [zoom]);

  // Progress save on page change. Debounced so a fast-flip burst saves once.
  useEffect(() => {
    if (!loaded || numPages === 0) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      fetch("/api/progress", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bookId,
          anchor: { type: "pdf-page", page },
          percent: page / numPages,
        }),
      }).catch(() => {
        /* transient */
      });
    }, 800);
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [page, bookId, numPages, loaded]);

  // Keyboard nav — paginated mode only. Scroll mode lets the browser
  // handle arrow keys natively for free-scroll feel.
  useEffect(() => {
    if (mode !== "paginated") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight" || e.key === "PageDown" || e.key === " ") {
        e.preventDefault();
        setPage((p) => Math.min(p + 1, numPages || p + 1));
      } else if (e.key === "ArrowLeft" || e.key === "PageUp") {
        e.preventDefault();
        setPage((p) => Math.max(p - 1, 1));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mode, numPages]);

  // Scroll mode: jump to the saved page once the document loads.
  useEffect(() => {
    if (mode !== "scrolled" || !loaded) return;
    const target = pageRefs.current.get(initialPage);
    target?.scrollIntoView({ block: "start" });
    // Intentionally only on initial load — subsequent page changes
    // come from the IntersectionObserver below, not the other way.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, mode]);

  // Scroll mode: track the page closest to the top of the viewport so
  // progress saves match what the user is actually reading.
  useEffect(() => {
    if (mode !== "scrolled" || !loaded) return;
    const container = containerRef.current;
    if (!container) return;

    const observer = new IntersectionObserver(
      (entries) => {
        // The entry with the largest intersection ratio is what's
        // currently filling the viewport.
        const top = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (!top) return;
        const n = Number((top.target as HTMLElement).dataset.page);
        if (Number.isFinite(n) && n !== page) setPage(n);
      },
      { root: container, threshold: [0.25, 0.5, 0.75] },
    );

    pageRefs.current.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [mode, loaded, numPages, page]);

  const onDocLoad = useCallback(
    ({ numPages: n }: { numPages: number }) => {
      setNumPages(n);
      setPage((p) => Math.min(Math.max(p, 1), n));
      setLoaded(true);
    },
    [],
  );

  const goPrev = () => setPage((p) => Math.max(p - 1, 1));
  const goNext = () => setPage((p) => Math.min(p + 1, numPages || p + 1));

  // baseRenderWidth = fit-to-width, then user zoom factor applied.
  const baseRenderWidth = Math.min(Math.max(width - 80, 320), 1100);
  const renderWidth = (baseRenderWidth * zoom) / 100;
  // Spacer height for off-window pages (~US-Letter aspect). Rough is fine: the
  // current page and its neighbors always render real, so any layout shift
  // happens off-screen at the window edges.
  const estPageHeight = Math.round(renderWidth * 1.3);
  const progressPct = numPages > 0 ? (page / numPages) * 100 : 0;

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
          fontPercent={zoom}
          onFontStep={(delta) => setZoom((z) => stepZoom(z, delta))}
          mode={mode}
          onModeChange={setMode}
        />
        <div className="text-xs text-zinc-600 tabular-nums">
          {numPages > 0 ? `${page} / ${numPages}` : "Loading…"}
        </div>
      </header>

      <div
        ref={containerRef}
        className="relative flex-1 overflow-auto"
      >
        <Document
          file={fileUrl}
          onLoadSuccess={onDocLoad}
          loading={
            <div className="p-8 text-sm text-zinc-600">Loading book…</div>
          }
          error={
            <div className="p-8 text-sm text-amber-500">
              Failed to load PDF
            </div>
          }
        >
          {mode === "paginated" ? (
            <div className="flex min-h-full items-start justify-center py-6">
              {width > 0 && (
                <div className="shadow-2xl shadow-black/60">
                  <Page
                    pageNumber={page}
                    width={renderWidth}
                    renderAnnotationLayer={false}
                    renderTextLayer
                  />
                </div>
              )}
            </div>
          ) : (
            <div className="flex flex-col items-center gap-4 py-6">
              {width > 0 &&
                numPages > 0 &&
                Array.from({ length: numPages }, (_, i) => i + 1).map((p) => {
                  // Only mount the real <Page> for pages within the window of
                  // the current page; everything else is a sized spacer. The
                  // wrapper (ref + data-page) always renders so scroll length
                  // and the IntersectionObserver page-tracking stay intact.
                  const active = Math.abs(p - page) <= SCROLL_WINDOW;
                  return (
                    <div
                      key={p}
                      data-page={p}
                      ref={(el) => {
                        if (el) pageRefs.current.set(p, el);
                        else pageRefs.current.delete(p);
                      }}
                      className={active ? "shadow-2xl shadow-black/60" : ""}
                    >
                      {active ? (
                        <Page
                          pageNumber={p}
                          width={renderWidth}
                          renderAnnotationLayer={false}
                          renderTextLayer
                        />
                      ) : (
                        <div
                          style={{ width: renderWidth, height: estPageHeight }}
                          className="flex items-center justify-center bg-zinc-900/40 text-xs text-zinc-700"
                        >
                          {p}
                        </div>
                      )}
                    </div>
                  );
                })}
            </div>
          )}
        </Document>

        {mode === "paginated" && (
          <>
            <button
              aria-label="Previous page"
              onClick={goPrev}
              disabled={page <= 1}
              className="absolute left-0 top-0 z-10 flex h-full w-24 items-center justify-start pl-4 text-zinc-700 opacity-0 transition-opacity hover:bg-gradient-to-r hover:from-zinc-900/50 hover:opacity-100 disabled:pointer-events-none disabled:opacity-0"
            >
              <ChevronLeft size={32} />
            </button>
            <button
              aria-label="Next page"
              onClick={goNext}
              disabled={numPages > 0 && page >= numPages}
              className="absolute right-0 top-0 z-10 flex h-full w-24 items-center justify-end pr-4 text-zinc-700 opacity-0 transition-opacity hover:bg-gradient-to-l hover:from-zinc-900/50 hover:opacity-100 disabled:pointer-events-none disabled:opacity-0"
            >
              <ChevronRight size={32} />
            </button>
          </>
        )}
      </div>

      <div className="h-0.5 w-full bg-zinc-900">
        <div
          className="h-full bg-amber-500/70 transition-[width] duration-200"
          style={{ width: `${progressPct.toFixed(2)}%` }}
        />
      </div>
    </div>
  );
}
