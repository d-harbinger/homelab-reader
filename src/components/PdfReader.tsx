"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  BookOpen,
  ChevronLeft,
  ChevronRight,
  Notebook,
  Pencil,
  ScrollText,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { ReaderContextMenu } from "./ReaderContextMenu";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";
import {
  ReaderToolbar,
  readSetting,
  writeSetting,
} from "./ReaderToolbar";
import {
  HIGHLIGHT_COLORS,
  type HighlightColor,
} from "@/lib/highlight-colors";
import {
  HighlightsPanel,
  type PanelHighlight,
  type PanelNote,
} from "./HighlightsPanel";
import { ColorPickerPopover, HighlightMenu, NoteEditorPopover } from "./HighlightPopover";
import { InkLayer } from "./InkLayer";
import { InkToolbar } from "./InkToolbar";
import {
  INK_COLORS,
  INK_OPACITIES,
  INK_WIDTHS,
  HIGHLIGHTER_COLORS,
  HIGHLIGHTER_WIDTHS,
  HIGHLIGHTER_OPACITY,
  type InkStroke,
  type InkPoint,
  type InkKind,
} from "@/lib/ink";

pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";

interface Props {
  bookId: string;
  title: string;
  fileUrl: string;
  initialPage: number;
  scannerPageCount: number | null;
}

// A highlight rectangle stored as fractions (0..1) of the page box, NOT pixels.
// Fractions survive zoom and re-render: the overlay positions each rect with CSS
// percentages against the (position:relative) page wrapper, so no pixel math runs
// at paint time and the highlight tracks the text at any zoom level.
interface PdfRect {
  x: number;
  y: number;
  w: number;
  h: number;
}
interface PdfAnchor {
  type: "pdf-rect";
  page: number;
  rects: PdfRect[];
}
interface PdfHighlight {
  id: string;
  color: HighlightColor;
  text: string;
  anchor: PdfAnchor;
}
interface PdfSelection {
  page: number;
  rects: PdfRect[];
  text: string;
  // Viewport coordinates for the floating color picker (no iframe here, unlike
  // the EPUB reader, so client coordinates are already page-absolute).
  x: number;
  y: number;
}
interface OpenHighlightMenu {
  id: string;
  color: HighlightColor;
  x: number;
  y: number;
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

  // Annotation state. highlightsRef mirrors the list for the selection handler
  // (which reads it outside React's render cycle); React state drives paint.
  const highlightsRef = useRef<Map<string, PdfHighlight>>(new Map());
  const [highlights, setHighlights] = useState<PdfHighlight[]>([]);
  const [notes, setNotes] = useState<PanelNote[]>([]);
  const [panelOpen, setPanelOpen] = useState(false);
  const [selection, setSelection] = useState<PdfSelection | null>(null);
  const [openMenu, setOpenMenu] = useState<OpenHighlightMenu | null>(null);
  // Right-click menu on plain page surface (highlights and selections
  // route to their own popovers instead — see onContextMenu).
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null);
  // The inline note editor floated at a highlight (opened from its menu).
  const [noteDraft, setNoteDraft] = useState<{
    h: PanelHighlight;
    noteId: string | null;
    body: string;
    x: number;
    y: number;
  } | null>(null);

  // Draw-tool state. Drawing takes over the pointer, so it's a distinct mode
  // from reading/highlighting (which use text selection).
  const [drawMode, setDrawMode] = useState(false);
  const [erasing, setErasing] = useState(false);
  // Two instruments share the Draw tool. Each remembers its own color/width;
  // the highlighter's opacity is fixed (multiply blend does the see-through).
  const [tool, setTool] = useState<InkKind>("pen");
  const [inkColor, setInkColor] = useState<string>(INK_COLORS[0].value);
  const [inkWidth, setInkWidth] = useState<number>(INK_WIDTHS[1].value);
  const [inkOpacity, setInkOpacity] = useState<number>(INK_OPACITIES[0].value);
  const [hlColor, setHlColor] = useState<string>(HIGHLIGHTER_COLORS[0].value);
  const [hlWidth, setHlWidth] = useState<number>(HIGHLIGHTER_WIDTHS[1].value);
  const [inkStrokes, setInkStrokes] = useState<InkStroke[]>([]);
  const inkTemp = useRef(0);

  // The live values for whichever instrument is selected — fed to the toolbar
  // and the overlay so drawing previews match what will be saved.
  const drawingHl = tool === "highlighter";
  const activeColor = drawingHl ? hlColor : inkColor;
  const activeWidth = drawingHl ? hlWidth : inkWidth;
  const activeOpacity = drawingHl ? HIGHLIGHTER_OPACITY : inkOpacity;

  // Stable ref registrar shared by both render modes so selection lookup and
  // scroll-to-page can always find a page's wrapper element by number.
  const registerPage = useCallback(
    (p: number) => (el: HTMLDivElement | null) => {
      if (el) pageRefs.current.set(p, el);
      else pageRefs.current.delete(p);
    },
    [],
  );

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

  // Load saved highlights + notes once, independent of PDF render. Highlights
  // paint onto their page as it mounts; notes surface in the side panel.
  const loadAnnotations = useCallback(async () => {
    try {
      const [hRes, nRes] = await Promise.all([
        fetch(`/api/highlights?bookId=${encodeURIComponent(bookId)}`),
        fetch(`/api/notes?bookId=${encodeURIComponent(bookId)}`),
      ]);
      if (hRes.ok) {
        const data = (await hRes.json()) as {
          highlights: { id: string; color: HighlightColor; text: string; anchor: unknown }[];
        };
        const pdfHls = data.highlights.filter(
          (h): h is PdfHighlight =>
            !!h.anchor &&
            (h.anchor as PdfAnchor).type === "pdf-rect" &&
            Array.isArray((h.anchor as PdfAnchor).rects),
        );
        highlightsRef.current = new Map(pdfHls.map((h) => [h.id, h]));
        setHighlights(pdfHls);
      }
      if (nRes.ok) {
        const data = (await nRes.json()) as { notes: PanelNote[] };
        setNotes(data.notes);
      }
    } catch {
      /* non-blocking */
    }
  }, [bookId]);

  useEffect(() => {
    loadAnnotations();
  }, [loadAnnotations]);

  // Load saved ink strokes; each paints on its page as that page mounts.
  const loadInk = useCallback(async () => {
    try {
      const r = await fetch(`/api/ink?bookId=${encodeURIComponent(bookId)}`);
      if (r.ok) {
        const data = (await r.json()) as { strokes: InkStroke[] };
        setInkStrokes(data.strokes);
      }
    } catch {
      /* non-blocking */
    }
  }, [bookId]);

  useEffect(() => {
    loadInk();
  }, [loadInk]);

  // Commit a finished stroke: show it immediately (optimistic, temp id), POST,
  // then swap in the server id. On failure, drop the optimistic stroke.
  const saveStroke = useCallback(
    async (pageNum: number, points: InkPoint[]) => {
      const tempId = `tmp-${++inkTemp.current}`;
      // Snapshot the active instrument at commit time (strokeWidth is named to
      // avoid shadowing the page-render `width` state).
      const strokeKind: InkKind = tool;
      const strokeColor = drawingHl ? hlColor : inkColor;
      const strokeWidth = drawingHl ? hlWidth : inkWidth;
      const strokeOpacity = drawingHl ? HIGHLIGHTER_OPACITY : inkOpacity;
      const optimistic: InkStroke = {
        id: tempId,
        page: pageNum,
        color: strokeColor,
        width: strokeWidth,
        opacity: strokeOpacity,
        kind: strokeKind,
        points,
      };
      setInkStrokes((prev) => [...prev, optimistic]);
      try {
        const r = await fetch("/api/ink", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            bookId,
            page: pageNum,
            points,
            color: strokeColor,
            width: strokeWidth,
            opacity: strokeOpacity,
            kind: strokeKind,
          }),
        });
        if (!r.ok) throw new Error("save failed");
        const row = (await r.json()) as InkStroke;
        setInkStrokes((prev) => prev.map((s) => (s.id === tempId ? row : s)));
      } catch {
        setInkStrokes((prev) => prev.filter((s) => s.id !== tempId));
      }
    },
    [bookId, tool, drawingHl, inkColor, inkWidth, inkOpacity, hlColor, hlWidth],
  );

  const eraseStroke = useCallback(async (id: string) => {
    setInkStrokes((prev) => prev.filter((s) => s.id !== id));
    if (id.startsWith("tmp-")) return; // never persisted
    try {
      await fetch(`/api/ink/${id}`, { method: "DELETE" });
    } catch {
      /* the row will reappear on next load if this failed; acceptable */
    }
  }, []);

  const undoInk = useCallback(() => {
    setInkStrokes((prev) => {
      if (prev.length === 0) return prev;
      const last = prev[prev.length - 1];
      if (!last.id.startsWith("tmp-")) {
        fetch(`/api/ink/${last.id}`, { method: "DELETE" }).catch(() => {});
      }
      return prev.slice(0, -1);
    });
  }, []);

  const inkForPage = (p: number) => inkStrokes.filter((s) => s.page === p);

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

  // Text selection → color-picker popover. Reads the live selection on mouseup,
  // maps it to the page it lands in, and converts each line-rect of the range
  // into page-relative fractions. No iframe here (unlike EPUB), so getClientRects
  // is already in viewport coordinates.
  const onMouseUp = useCallback(() => {
    if (drawMode) return; // the ink overlay owns the pointer while drawing
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return;
    const text = sel.toString().trim();
    if (!text) return;

    const range = sel.getRangeAt(0);
    let node: Node | null = range.startContainer;
    let pageEl: HTMLElement | null = null;
    while (node) {
      if (node instanceof HTMLElement && node.dataset.page) {
        pageEl = node;
        break;
      }
      node = node.parentNode;
    }
    if (!pageEl) return;

    const pageNum = Number(pageEl.dataset.page);
    const pageRect = pageEl.getBoundingClientRect();
    if (!pageRect.width || !pageRect.height) return;

    const clientRects = Array.from(range.getClientRects());
    const rects: PdfRect[] = clientRects
      .filter((r) => r.width > 1 && r.height > 1)
      .map((r) => ({
        x: (r.left - pageRect.left) / pageRect.width,
        y: (r.top - pageRect.top) / pageRect.height,
        w: r.width / pageRect.width,
        h: r.height / pageRect.height,
      }))
      // Drop fragments outside this page (a selection dragged across a page
      // boundary in scroll mode) — anchor the highlight to the start page only.
      .filter((r) => r.y >= -0.02 && r.y <= 1.02);
    if (rects.length === 0) return;

    const first = clientRects[0];
    setSelection({
      page: pageNum,
      rects,
      text,
      x: first.left + first.width / 2,
      y: first.top,
    });
    setOpenMenu(null);
  }, [drawMode]);

  // Dismiss popovers on outside click (microtask skips the opening click).
  useEffect(() => {
    if (!selection && !openMenu) return;
    const onDocClick = () => {
      setSelection(null);
      setOpenMenu(null);
    };
    const t = setTimeout(
      () => document.addEventListener("click", onDocClick, { once: true }),
      0,
    );
    return () => {
      clearTimeout(t);
      document.removeEventListener("click", onDocClick);
    };
  }, [selection, openMenu, ctxMenu]);

  // Wheel turns the page in paginated mode. Scroll mode keeps native
  // wheel scrolling; and when a zoomed page overflows the container in
  // paginated mode, the wheel scrolls that page and only turns once the
  // relevant edge is reached. Accumulate + throttle so a trackpad
  // doesn't multi-flip on one gesture. Native listener (passive:false)
  // because React's onWheel can't preventDefault.
  useEffect(() => {
    if (mode !== "paginated") return;
    const el = containerRef.current;
    if (!el) return;
    let accum = 0;
    let lastFlip = 0;
    const onWheel = (e: WheelEvent) => {
      if (drawMode) return; // the ink overlay owns the surface
      const canScroll = el.scrollHeight > el.clientHeight + 1;
      if (canScroll) {
        const atTop = el.scrollTop <= 0;
        const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 1;
        if (!(e.deltaY > 0 ? atBottom : atTop)) return; // let it scroll
      }
      e.preventDefault();
      const now = Date.now();
      if (now - lastFlip < 400) return;
      accum += e.deltaY;
      if (Math.abs(accum) < 40) return;
      const forward = accum > 0;
      accum = 0;
      lastFlip = now;
      setPage((p) =>
        forward ? Math.min(p + 1, numPages || p + 1) : Math.max(p - 1, 1),
      );
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [mode, numPages, drawMode]);

  // Right-click on the reading surface. Highlight rects handle their own
  // contextmenu (HighlightLayer) and stop propagation before this runs;
  // a live selection re-opens the color picker; plain page gets the
  // reader menu. Coordinates are already viewport-absolute (no iframe).
  const onContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed && sel.toString().trim()) {
      setCtxMenu(null);
      onMouseUp();
      return;
    }
    setSelection(null);
    setOpenMenu(null);
    setCtxMenu({ x: e.clientX, y: e.clientY });
  };

  const onDocLoad = useCallback(({ numPages: n }: { numPages: number }) => {
    setNumPages(n);
    setPage((p) => Math.min(Math.max(p, 1), n));
    setLoaded(true);
  }, []);

  const goPrev = () => setPage((p) => Math.max(p - 1, 1));
  const goNext = () => setPage((p) => Math.min(p + 1, numPages || p + 1));

  async function saveHighlight(color: HighlightColor) {
    if (!selection) return;
    const anchor: PdfAnchor = {
      type: "pdf-rect",
      page: selection.page,
      rects: selection.rects,
    };
    try {
      const r = await fetch("/api/highlights", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bookId, anchor, text: selection.text, color }),
      });
      if (!r.ok) return;
      const row = (await r.json()) as PdfHighlight;
      highlightsRef.current.set(row.id, row);
      setHighlights((prev) => [...prev, row]);
    } catch {
      /* fail silently — user can retry */
    } finally {
      setSelection(null);
      window.getSelection()?.removeAllRanges();
    }
  }

  async function changeColor(id: string, color: HighlightColor) {
    try {
      const r = await fetch(`/api/highlights/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ color }),
      });
      if (!r.ok) return;
      const current = highlightsRef.current.get(id);
      if (!current) return;
      const next = { ...current, color };
      highlightsRef.current.set(id, next);
      setHighlights((prev) => prev.map((h) => (h.id === id ? next : h)));
    } finally {
      setOpenMenu(null);
    }
  }

  async function deleteHighlight(id: string) {
    try {
      await fetch(`/api/highlights/${id}`, { method: "DELETE" });
      highlightsRef.current.delete(id);
      setHighlights((prev) => prev.filter((x) => x.id !== id));
      // A note bound to this highlight is orphaned; drop it from the panel too.
      setNotes((prev) => prev.filter((n) => n.highlightId !== id));
    } finally {
      setOpenMenu(null);
    }
  }

  async function saveNote(
    h: PanelHighlight,
    body: string,
    existingId: string | null,
  ) {
    try {
      if (existingId) {
        const r = await fetch(`/api/notes/${existingId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ body }),
        });
        if (!r.ok) return;
        const row = (await r.json()) as PanelNote;
        setNotes((prev) =>
          prev.map((n) => (n.id === existingId ? { ...n, body: row.body } : n)),
        );
      } else {
        const r = await fetch("/api/notes", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            bookId,
            anchor: { type: "pdf-rect", page: h.anchor.page },
            body,
            context: h.text.slice(0, 200),
            // PDF highlights carry no cfi, so the note binds by FK.
            highlightId: h.id,
          }),
        });
        if (!r.ok) return;
        const row = (await r.json()) as PanelNote;
        setNotes((prev) => [...prev, row]);
      }
    } catch {
      /* transient */
    }
  }

  async function deleteNote(id: string) {
    try {
      await fetch(`/api/notes/${id}`, { method: "DELETE" });
      setNotes((prev) => prev.filter((n) => n.id !== id));
    } catch {
      /* transient */
    }
  }

  function jumpToHighlight(h: PanelHighlight) {
    const p = h.anchor.page;
    if (typeof p !== "number") return;
    if (mode === "scrolled") {
      pageRefs.current.get(p)?.scrollIntoView({ block: "start" });
    } else {
      setPage(Math.min(Math.max(p, 1), numPages || p));
    }
  }

  // From the highlight menu's note action: open the note editor at the
  // highlight, pre-filled if it already has a note.
  const openNoteEditor = () => {
    if (!openMenu) return;
    const hl = highlightsRef.current.get(openMenu.id);
    if (!hl) return;
    const existing = notes.find((n) => n.highlightId === openMenu.id) ?? null;
    setNoteDraft({
      h: hl,
      noteId: existing?.id ?? null,
      body: existing?.body ?? "",
      x: openMenu.x,
      y: openMenu.y,
    });
    setOpenMenu(null);
  };

  const openHighlightMenu = (h: PdfHighlight, e: React.MouseEvent) => {
    setOpenMenu({ id: h.id, color: h.color, x: e.clientX, y: e.clientY });
    setSelection(null);
  };

  const highlightsForPage = (p: number) =>
    highlights.filter((h) => h.anchor.page === p);

  // baseRenderWidth = fit-to-width, then user zoom factor applied.
  const baseRenderWidth = Math.min(Math.max(width - 80, 320), 1100);
  const renderWidth = (baseRenderWidth * zoom) / 100;
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
        <div className="flex items-center gap-3">
          <button
            onClick={() => {
              setDrawMode((v) => !v);
              setErasing(false);
            }}
            aria-label="Draw"
            aria-pressed={drawMode}
            title="Draw on the page"
            className={`rounded p-1.5 transition-colors ${
              drawMode
                ? "bg-amber-500 text-zinc-950"
                : "text-zinc-500 hover:bg-zinc-900 hover:text-zinc-200"
            }`}
          >
            <Pencil size={14} />
          </button>
          <button
            onClick={() => setPanelOpen((v) => !v)}
            aria-label="Highlights and notes"
            title="Highlights & notes"
            className={`relative rounded p-1.5 transition-colors ${
              panelOpen
                ? "bg-zinc-800 text-zinc-100"
                : "text-zinc-500 hover:bg-zinc-900 hover:text-zinc-200"
            }`}
          >
            <Notebook size={14} />
            {highlights.length > 0 && (
              <span className="absolute -right-1 -top-1 flex h-3.5 min-w-[14px] items-center justify-center rounded-full bg-amber-500/80 px-1 text-[9px] font-medium text-zinc-950">
                {highlights.length}
              </span>
            )}
          </button>
          <div className="text-xs text-zinc-600 tabular-nums">
            {numPages > 0 ? `${page} / ${numPages}` : "Loading…"}
          </div>
        </div>
      </header>

      {drawMode && (
        <InkToolbar
          tool={tool}
          color={activeColor}
          width={activeWidth}
          opacity={activeOpacity}
          erasing={erasing}
          canUndo={inkStrokes.length > 0}
          onTool={(t) => {
            setTool(t);
            setErasing(false);
          }}
          onColor={(c) => {
            (tool === "highlighter" ? setHlColor : setInkColor)(c);
            setErasing(false);
          }}
          onWidth={(w) => (tool === "highlighter" ? setHlWidth : setInkWidth)(w)}
          onOpacity={setInkOpacity}
          onToggleErase={() => setErasing((v) => !v)}
          onUndo={undoInk}
        />
      )}

      <div
        ref={containerRef}
        className="scroll-slim relative flex-1 overflow-auto"
        onMouseUp={onMouseUp}
        onContextMenu={onContextMenu}
      >
        <Document
          file={fileUrl}
          onLoadSuccess={onDocLoad}
          loading={
            <div className="p-8 text-sm text-zinc-600">Loading book…</div>
          }
          error={
            <div className="p-8 text-sm text-amber-500">Failed to load PDF</div>
          }
        >
          {mode === "paginated" ? (
            <div className="flex min-h-full items-start justify-center py-6">
              {width > 0 && (
                <div
                  data-page={page}
                  ref={registerPage(page)}
                  className={`relative shadow-2xl shadow-black/60 ${drawMode ? "select-none" : ""}`}
                >
                  <Page
                    pageNumber={page}
                    width={renderWidth}
                    renderAnnotationLayer={false}
                    renderTextLayer
                  />
                  <HighlightLayer
                    highlights={highlightsForPage(page)}
                    onOpen={openHighlightMenu}
                  />
                  <InkLayer
                    strokes={inkForPage(page)}
                    drawMode={drawMode}
                    erasing={erasing}
                    color={activeColor}
                    width={activeWidth}
                    opacity={activeOpacity}
                    kind={tool}
                    onCommit={(pts) => saveStroke(page, pts)}
                    onErase={eraseStroke}
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
                      ref={registerPage(p)}
                      className={`relative ${active ? "shadow-2xl shadow-black/60" : ""} ${drawMode ? "select-none" : ""}`}
                    >
                      {active ? (
                        <>
                          <Page
                            pageNumber={p}
                            width={renderWidth}
                            renderAnnotationLayer={false}
                            renderTextLayer
                          />
                          <HighlightLayer
                            highlights={highlightsForPage(p)}
                            onOpen={openHighlightMenu}
                          />
                          <InkLayer
                            strokes={inkForPage(p)}
                            drawMode={drawMode}
                            erasing={erasing}
                            color={activeColor}
                            width={activeWidth}
                            opacity={activeOpacity}
                            kind={tool}
                            onCommit={(pts) => saveStroke(p, pts)}
                            onErase={eraseStroke}
                          />
                        </>
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

      {selection && (
        <ColorPickerPopover
          x={selection.x}
          y={selection.y}
          onPick={(c) => saveHighlight(c)}
        />
      )}

      {openMenu && (
        <HighlightMenu
          x={openMenu.x}
          y={openMenu.y}
          activeColor={openMenu.color}
          hasNote={notes.some((n) => n.highlightId === openMenu.id)}
          onPick={(c) => changeColor(openMenu.id, c)}
          onAddNote={openNoteEditor}
          onDelete={() => deleteHighlight(openMenu.id)}
        />
      )}

      {noteDraft && (
        <NoteEditorPopover
          x={noteDraft.x}
          y={noteDraft.y}
          initialBody={noteDraft.body}
          onSave={(body) => {
            saveNote(noteDraft.h, body, noteDraft.noteId);
            setNoteDraft(null);
          }}
          onCancel={() => setNoteDraft(null)}
        />
      )}

      {ctxMenu && (
        <ReaderContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          onClose={() => setCtxMenu(null)}
          items={[
            {
              label: "Previous page",
              icon: <ChevronLeft size={14} />,
              onSelect: goPrev,
              disabled: mode !== "paginated" || page <= 1,
            },
            {
              label: "Next page",
              icon: <ChevronRight size={14} />,
              onSelect: goNext,
              disabled: mode !== "paginated" || (numPages > 0 && page >= numPages),
            },
            "divider",
            {
              label: "Paginated",
              icon: <BookOpen size={14} />,
              active: mode === "paginated",
              onSelect: () => setMode("paginated"),
            },
            {
              label: "Scrolled",
              icon: <ScrollText size={14} />,
              active: mode === "scrolled",
              onSelect: () => setMode("scrolled"),
            },
            "divider",
            {
              label: "Zoom out",
              icon: <ZoomOut size={14} />,
              onSelect: () => setZoom((z) => stepZoom(z, -1)),
            },
            {
              label: "Zoom in",
              icon: <ZoomIn size={14} />,
              onSelect: () => setZoom((z) => stepZoom(z, 1)),
            },
            "divider",
            {
              label: drawMode ? "Stop drawing" : "Draw on the page",
              icon: <Pencil size={14} />,
              active: drawMode,
              onSelect: () => {
                setDrawMode((v) => !v);
                setErasing(false);
              },
            },
            {
              label: "Highlights & notes",
              icon: <Notebook size={14} />,
              active: panelOpen,
              onSelect: () => setPanelOpen((v) => !v),
            },
          ]}
        />
      )}

      <HighlightsPanel
        open={panelOpen}
        onClose={() => setPanelOpen(false)}
        highlights={highlights}
        notes={notes}
        onJump={jumpToHighlight}
        onColorChange={changeColor}
        onDelete={deleteHighlight}
        onNoteSave={saveNote}
        onNoteDelete={deleteNote}
      />
    </div>
  );
}

// Overlay painted inside each page wrapper (position:relative). The layer itself
// ignores pointer events so text selection passes through to the PDF text layer;
// each highlight rect re-enables them so a click opens the recolor/delete menu.
// Rects are CSS percentages, so they track the page at any zoom with no recompute.
function HighlightLayer({
  highlights,
  onOpen,
}: {
  highlights: PdfHighlight[];
  onOpen: (h: PdfHighlight, e: React.MouseEvent) => void;
}) {
  return (
    <div className="pointer-events-none absolute inset-0 z-10">
      {highlights.flatMap((h) =>
        h.anchor.rects.map((r, i) => (
          <div
            key={`${h.id}-${i}`}
            onClick={(e) => {
              e.stopPropagation();
              onOpen(h, e);
            }}
            onContextMenu={(e) => {
              // Right-click on a highlight = the same menu as a click,
              // never the browser menu or the plain-page reader menu.
              e.preventDefault();
              e.stopPropagation();
              onOpen(h, e);
            }}
            className="pointer-events-auto absolute cursor-pointer"
            style={{
              left: `${r.x * 100}%`,
              top: `${r.y * 100}%`,
              width: `${r.w * 100}%`,
              height: `${r.h * 100}%`,
              background: HIGHLIGHT_COLORS[h.color].fill,
              mixBlendMode: "multiply",
            }}
          />
        )),
      )}
    </div>
  );
}
