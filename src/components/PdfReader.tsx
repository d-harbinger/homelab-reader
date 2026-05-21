"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import Link from "next/link";
import { ArrowLeft, ChevronLeft, ChevronRight } from "lucide-react";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";

// Point pdfjs at our same-origin worker route. CDN-served workers are
// the react-pdf docs default — they don't fit a LAN-only homelab.
pdfjs.GlobalWorkerOptions.workerSrc = "/api/pdfjs-worker";

interface Props {
  bookId: string;
  title: string;
  fileUrl: string;
  initialPage: number;
  scannerPageCount: number | null;
}

export function PdfReader({
  bookId,
  title,
  fileUrl,
  initialPage,
  scannerPageCount,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [page, setPage] = useState(initialPage);
  const [numPages, setNumPages] = useState(scannerPageCount ?? 0);
  const [loaded, setLoaded] = useState(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Fit-to-width — observe container size, render the Page at that width.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const measure = () => setWidth(el.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Persist progress on page change, debounced — page-turn happy fingers
  // shouldn't hammer the API.
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
        /* transient — next page-turn retries */
      });
    }, 800);
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [page, bookId, numPages, loaded]);

  // Keyboard nav.
  useEffect(() => {
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
  }, [numPages]);

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

  const renderWidth = Math.min(Math.max(width - 80, 320), 1100);
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
        <div className="text-xs text-zinc-600 tabular-nums">
          {numPages > 0 ? `${page} / ${numPages}` : "Loading…"}
        </div>
      </header>

      <div
        ref={containerRef}
        className="relative flex-1 overflow-auto"
      >
        <div className="flex min-h-full items-start justify-center py-6">
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
            className="shadow-2xl shadow-black/60"
          >
            {width > 0 && (
              <Page
                pageNumber={page}
                width={renderWidth}
                renderAnnotationLayer={false}
                renderTextLayer={true}
              />
            )}
          </Document>
        </div>

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
