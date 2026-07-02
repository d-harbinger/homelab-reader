"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import Link from "next/link";
import { ArrowLeft, ChevronLeft, ChevronRight, Notebook } from "lucide-react";
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
import { ColorPickerPopover, HighlightMenu } from "./HighlightPopover";

interface Props {
  bookId: string;
  title: string;
  fileUrl: string;
  initialCfi: string | null;
}

// Loose epub.js types — the lib's own types are wide-open Any anyway.
interface ContentsLike {
  document: Document;
  window: Window;
  range(cfi: string): Range;
  cfiFromRange?(range: Range): string;
}
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
    fontSize(value: string): void;
  };
  annotations: {
    add(
      type: string,
      cfiRange: string,
      data?: Record<string, unknown>,
      cb?: (e: MouseEvent) => void,
      className?: string,
      styles?: Record<string, string>,
    ): unknown;
    remove(cfiRange: string, type: string): void;
  };
  getContents(): ContentsLike[];
}
interface SpineItemLike {
  href: string;
  index: number;
  linear?: string;
}
interface BookLike {
  ready: Promise<unknown>;
  destroy(): void;
  renderTo(target: HTMLElement, opts: Record<string, unknown>): RenditionLike;
  spine: { items: SpineItemLike[] };
  locations: {
    generate(charsPerLocation: number): Promise<unknown>;
    percentageFromCfi(cfi: string): number;
    length(): number;
  };
}

interface StoredHighlight {
  id: string;
  color: HighlightColor;
  text: string;
  anchor: { type: string; cfi?: string };
}

interface SelectionState {
  cfiRange: string;
  text: string;
  // Outer-page coordinates for the floating popover.
  x: number;
  y: number;
}

interface OpenHighlightMenu {
  id: string;
  color: HighlightColor;
  x: number;
  y: number;
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
  const highlightsRef = useRef<Map<string, StoredHighlight>>(new Map());
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
  const [selection, setSelection] = useState<SelectionState | null>(null);
  const [openMenu, setOpenMenu] = useState<OpenHighlightMenu | null>(null);
  // Panel state — list of highlights and notes for this book. Mirrored
  // by highlightsRef for the rendition-paint path; React state drives
  // the panel UI.
  const [panelOpen, setPanelOpen] = useState(false);
  const [highlights, setHighlights] = useState<PanelHighlight[]>([]);
  const [notes, setNotes] = useState<PanelNote[]>([]);

  // Re-render an existing highlight (after a color change) by removing
  // the visual annotation and adding it back with the new fill color.
  const repaintHighlight = useCallback((h: StoredHighlight) => {
    const r = renditionRef.current;
    if (!r || !h.anchor.cfi) return;
    try {
      r.annotations.remove(h.anchor.cfi, "highlight");
    } catch {
      /* might not be present yet */
    }
    r.annotations.add(
      "highlight",
      h.anchor.cfi,
      { id: h.id },
      (e: MouseEvent) => {
        // Position the floating menu near the click. e.clientX/Y are
        // in iframe coordinates — convert by adding the iframe's
        // offset on the outer page.
        const target = e.target as HTMLElement | null;
        const iframe = target?.ownerDocument?.defaultView?.frameElement as
          | HTMLIFrameElement
          | null;
        const ifr = iframe?.getBoundingClientRect();
        setOpenMenu({
          id: h.id,
          color: h.color,
          x: (ifr?.left ?? 0) + e.clientX,
          y: (ifr?.top ?? 0) + e.clientY,
        });
        setSelection(null);
      },
      undefined,
      { fill: HIGHLIGHT_COLORS[h.color].fill, "fill-opacity": "0.45" },
    );
  }, []);

  // Load saved highlights + notes once the rendition is up, then paint
  // the highlights. Notes don't render in the book itself; they live in
  // the side panel.
  const loadHighlights = useCallback(async () => {
    try {
      const [hRes, nRes] = await Promise.all([
        fetch(`/api/highlights?bookId=${encodeURIComponent(bookId)}`),
        fetch(`/api/notes?bookId=${encodeURIComponent(bookId)}`),
      ]);
      if (hRes.ok) {
        const data = (await hRes.json()) as { highlights: StoredHighlight[] };
        highlightsRef.current = new Map(
          data.highlights.map((h) => [h.id, h]),
        );
        setHighlights(data.highlights as PanelHighlight[]);
        for (const h of data.highlights) repaintHighlight(h);
      }
      if (nRes.ok) {
        const data = (await nRes.json()) as { notes: PanelNote[] };
        setNotes(data.notes);
      }
    } catch {
      /* non-blocking */
    }
  }, [bookId, repaintHighlight]);

  useEffect(() => {
    let cancelled = false;
    const viewer = viewerRef.current;
    if (!viewer) return;

    (async () => {
      const { default: ePub } = await import("epubjs");
      if (cancelled) return;

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
        // Continuous manager needs flow:"scrolled" (it streams sections as you
        // scroll). Pairing it with "scrolled-doc" — the single-document mode —
        // renders a section but leaves scrolling dead.
        flow: mode === "scrolled" ? "scrolled" : "paginated",
        manager: mode === "scrolled" ? "continuous" : "default",
      });
      renditionRef.current = rendition;

      rendition.themes.register("homelab-dark", {
        // Theme the iframe's <html> too, not just <body>. In scroll mode the
        // iframe runs taller than the text, and a <body>-only background lets
        // the default-white <html> show through below the last line.
        html: { background: "#09090b" },
        body: {
          color: "#e4e4e7",
          background: "#09090b",
          "min-height": "100%",
          "font-family":
            '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, system-ui, sans-serif',
          "line-height": "1.6",
        },
        a: { color: "#fbbf24" },
        "h1, h2, h3, h4, h5, h6": { color: "#fafafa" },
      });
      rendition.themes.select("homelab-dark");
      rendition.themes.fontSize(`${fontPercent}%`);

      // Where to open. With saved progress, honor the CFI. With NO progress,
      // skip the cover (the first spine item) and open the first real content
      // section, so "Read" lands in the book instead of the cover. The cover
      // stays one page-back away.
      let target: string | undefined = initialCfi ?? undefined;
      if (!initialCfi) {
        try {
          await book.ready;
          if (cancelled) return;
          const items = book.spine?.items ?? [];
          const firstContent =
            items.find((it) => it.index > 0 && it.linear !== "no") ?? items[1];
          if (firstContent?.href) target = firstContent.href;
        } catch {
          /* fall back to the default first section (cover) */
        }
      }
      await rendition.display(target);
      if (cancelled) return;
      setReady(true);

      book.ready
        .then(() => book.locations.generate(1024))
        .catch(() => {
          /* best-effort */
        });

      await loadHighlights();

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

      // Text selection → show popover with color picker.
      const showPopoverFor = (
        cfiRange: string,
        contents: ContentsLike,
      ) => {
        const sel = contents.window.getSelection();
        const text = sel?.toString() ?? "";
        if (!text.trim()) return;

        let x = 0;
        let y = 0;
        try {
          const range = contents.range(cfiRange);
          const rect = range.getBoundingClientRect();
          const iframe = contents.document.defaultView?.frameElement as
            | HTMLIFrameElement
            | null;
          const ifr = iframe?.getBoundingClientRect();
          x = (ifr?.left ?? 0) + rect.left + rect.width / 2;
          y = (ifr?.top ?? 0) + rect.top;
        } catch {
          /* fall through */
        }

        setSelection({ cfiRange, text, x, y });
        setOpenMenu(null);
      };

      const onSelected = (...args: unknown[]) => {
        const cfiRange = args[0] as string;
        const contents = args[1] as ContentsLike | undefined;
        if (!contents || !cfiRange) return;
        showPopoverFor(cfiRange, contents);
      };
      rendition.on("selected", onSelected);

      // Belt-and-suspenders: a direct mouseup/touchend hook on each
      // rendered Contents document. epubjs's 'selected' event runs
      // through a 250ms selectionchange debounce and skips short or
      // collapsed ranges in paginated mode, so some selections never
      // fire it. This catches those by reading the live selection and
      // computing the CFI itself.
      //
      // Each spine section renders into its own iframe document; hook
      // each exactly once (deduped via the WeakSet) so listeners don't
      // pile up when a section is revisited or in continuous mode.
      const hookedDocs = new WeakSet<Document>();
      const hookSelection = (contents: ContentsLike) => {
        const doc = contents.document;
        if (hookedDocs.has(doc)) return;
        hookedDocs.add(doc);
        const handler = () => {
          const sel = contents.window.getSelection();
          if (!sel || sel.rangeCount === 0) return;
          const range = sel.getRangeAt(0);
          if (range.collapsed || !sel.toString().trim()) return;
          const cfi = contents.cfiFromRange?.(range);
          if (!cfi) return;
          showPopoverFor(cfi, contents);
        };
        doc.addEventListener("mouseup", handler);
        doc.addEventListener("touchend", handler);
      };

      // On every (re-)render: hook any new section documents for the
      // selection fallback, and repaint known highlights. epubjs keeps
      // annotations across page turns within a spine item but can lose
      // them crossing chapters, so repaint defensively.
      const onRendered = () => {
        for (const c of rendition.getContents()) hookSelection(c);
        for (const h of highlightsRef.current.values()) repaintHighlight(h);
      };
      rendition.on("rendered", onRendered);

      const onKey = (e: KeyboardEvent) => {
        if (mode !== "paginated") return;
        if (e.key === "ArrowRight" || e.key === " " || e.key === "PageDown") {
          rendition.next();
        } else if (e.key === "ArrowLeft" || e.key === "PageUp") {
          rendition.prev();
        }
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
    // mode triggers a rebuild; font size is handled by a separate effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookId, fileUrl, initialCfi, mode]);

  useEffect(() => {
    renditionRef.current?.themes.fontSize(`${fontPercent}%`);
    writeSetting("epub.font", fontPercent);
  }, [fontPercent]);

  useEffect(() => {
    writeSetting("epub.mode", mode);
  }, [mode]);

  // Dismiss popovers on outside click.
  useEffect(() => {
    if (!selection && !openMenu) return;
    const onDocClick = () => {
      setSelection(null);
      setOpenMenu(null);
    };
    // Microtask to skip the click that opened the popover.
    const t = setTimeout(
      () => document.addEventListener("click", onDocClick, { once: true }),
      0,
    );
    return () => {
      clearTimeout(t);
      document.removeEventListener("click", onDocClick);
    };
  }, [selection, openMenu]);

  async function saveHighlight(color: HighlightColor) {
    if (!selection) return;
    const anchor = { type: "epub-cfi-range", cfi: selection.cfiRange };
    try {
      const r = await fetch("/api/highlights", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bookId,
          anchor,
          text: selection.text,
          color,
        }),
      });
      if (!r.ok) return;
      const row = (await r.json()) as StoredHighlight;
      highlightsRef.current.set(row.id, row);
      setHighlights((prev) => [...prev, row as PanelHighlight]);
      repaintHighlight(row);
    } catch {
      /* fail silently — user can retry */
    } finally {
      setSelection(null);
      try {
        renditionRef.current
          ?.getContents()
          .forEach((c) => c.window.getSelection()?.removeAllRanges());
      } catch {
        /* ignore */
      }
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
      repaintHighlight(next);
    } finally {
      setOpenMenu(null);
    }
  }

  async function deleteHighlight(id: string) {
    const h = highlightsRef.current.get(id);
    try {
      await fetch(`/api/highlights/${id}`, { method: "DELETE" });
      highlightsRef.current.delete(id);
      setHighlights((prev) => prev.filter((x) => x.id !== id));
      if (h?.anchor.cfi) {
        try {
          renditionRef.current?.annotations.remove(h.anchor.cfi, "highlight");
        } catch {
          /* not painted right now */
        }
      }
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
            anchor: h.anchor,
            body,
            context: h.text.slice(0, 200),
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
    if (h.anchor.cfi) {
      renditionRef.current?.display(h.anchor.cfi);
    }
  }

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
          onFontStep={(delta) => setFontPercent((p) => stepFont(p, delta))}
          mode={mode}
          onModeChange={setMode}
        />
        <div className="flex items-center gap-3">
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
            {ready ? `${Math.round(percent * 100)}%` : "Loading…"}
          </div>
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
          onPick={(c) => changeColor(openMenu.id, c)}
          onDelete={() => deleteHighlight(openMenu.id)}
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

