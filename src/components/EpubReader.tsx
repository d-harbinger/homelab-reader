"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import Link from "next/link";
import useSWR from "swr";
import {
  ArrowLeft,
  BookOpen,
  ChevronLeft,
  ChevronRight,
  Highlighter,
  Notebook,
  Pencil,
  ScrollText,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { ReaderContextMenu } from "./ReaderContextMenu";
import { EpubInkLayer } from "./EpubInkLayer";
import { InkToolbar } from "./InkToolbar";
import {
  HIGHLIGHTER_COLORS,
  HIGHLIGHTER_OPACITY,
  HIGHLIGHTER_WIDTHS,
  INK_COLORS,
  INK_OPACITIES,
  INK_WIDTHS,
  type InkAnchor,
  type InkKind,
  type InkPoint,
  type InkStroke,
} from "@/lib/ink";
import { ThemeToggle } from "./ThemeToggle";
import {
  ReaderToolbar,
  readSetting,
  writeSetting,
} from "./ReaderToolbar";
import {
  HIGHLIGHT_COLORS,
  type ColorKeyMap,
  type HighlightColor,
} from "@/lib/highlight-colors";
import { fetcher } from "@/lib/fetcher";
import { isEditableTarget, isUndoShortcut } from "@/lib/reader-shortcuts";
import { extractQuoteContext } from "@/lib/annotations/quote-context";
import {
  sectionMatchesAnchor,
  buildUpgradePayload,
  jumpTarget,
  createResolutionTracker,
} from "@/lib/annotations/resolve-textquote";
import { toRange } from "dom-anchor-text-quote";
import {
  HighlightsPanel,
  type PanelHighlight,
  type PanelNote,
} from "./HighlightsPanel";
import { HighlightMenu, NoteEditorPopover } from "./HighlightPopover";

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
  // Returns a CFI STRING for any DOM node, despite epub.js's JSDoc claiming an
  // EpubCFI — the implementation calls .toString() on it (contents.js:1005).
  // This is how a freehand stroke fastens to the block it was drawn on.
  cfiFromNode?(node: Node, ignoreClass?: string): string;
  // Index of the spine section this Contents renders — maps back to
  // book.spine.items[sectionIndex] to recover the section href.
  sectionIndex?: number;
}
interface RenditionLike {
  display(target?: string | undefined): Promise<unknown>;
  next(): Promise<unknown>;
  prev(): Promise<unknown>;
  // No-arg form re-measures the container and reflows — epub.js itself only
  // watches WINDOW resize, so container-size changes (the highlights panel
  // pushing the reading column narrower) must call this explicitly.
  resize?(): void;
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
    cfiFromPercentage(percentage: number): string;
    length(): number;
  };
}

interface StoredHighlight {
  id: string;
  color: HighlightColor;
  text: string;
  // The stored anchor. A web-created highlight is an epub-cfi-range (has cfi).
  // A highlight synced from another device arrives as a text-quote anchor
  // (quote + optional prefix/suffix/chapterHref/progression, no cfi yet); the
  // reader resolves it to a CFI on view. See resolve-textquote.ts.
  anchor: {
    type: string;
    cfi?: string;
    quote?: string;
    prefix?: string;
    suffix?: string;
    chapterHref?: string;
    progression?: number;
  };
}

// Additive text-quote context captured at highlight creation, stored alongside
// the CFI inside the anchor JSON. It lets a highlight be re-found on another
// device by its surrounding text + reading position, not the CFI alone (Phase C
// text-quote sync). All fields optional — the CFI is still the primary anchor.
interface QuoteAnchorContext {
  prefix?: string;
  suffix?: string;
  progression?: number;
}

interface SelectionState {
  cfiRange: string;
  text: string;
  // Outer-page coordinates for the floating popover.
  x: number;
  y: number;
  // Captured when the selection is made (the DOM Range is in scope then), so
  // the popover-confirm path can persist it without re-walking the DOM.
  context?: QuoteAnchorContext;
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

// First / last descendant text node under `node` (inclusive of `node` itself).
function edgeTextNode(node: Node, last: boolean): Text | null {
  if (node.nodeType === Node.TEXT_NODE) return node as Text;
  const doc = node.ownerDocument;
  if (!doc) return null;
  const walker = doc.createTreeWalker(node, NodeFilter.SHOW_TEXT);
  let found: Text | null = null;
  let n = walker.nextNode();
  while (n) {
    found = n as Text;
    if (!last) break;
    n = walker.nextNode();
  }
  return found;
}

// Move any range boundary that sits on an element into the adjacent text node.
// dom-anchor-text-quote returns a boundary on the containing element when a
// quote begins or ends exactly at a child edge; the CFI epub.js derives from
// such a boundary does not re-resolve when the highlight mark is painted (it
// reads getClientRects on a null range). Descending both edges to text nodes
// yields a CFI that round-trips. Returns the original range if it can't descend.
function descendRangeToText(range: Range): Range {
  const r = range.cloneRange();
  if (r.startContainer.nodeType === Node.ELEMENT_NODE) {
    const el = r.startContainer as Element;
    const child = el.childNodes[r.startOffset] ?? el.childNodes[el.childNodes.length - 1];
    const t = child ? edgeTextNode(child, false) : null;
    if (t) r.setStart(t, 0);
  }
  if (r.endContainer.nodeType === Node.ELEMENT_NODE) {
    const el = r.endContainer as Element;
    const child = el.childNodes[r.endOffset - 1] ?? el.childNodes[0];
    const t = child ? edgeTextNode(child, true) : null;
    if (t) r.setEnd(t, t.data.length);
  }
  return r;
}

export function EpubReader({ bookId, title, fileUrl, initialCfi }: Props) {
  const viewerRef = useRef<HTMLDivElement>(null);
  const renditionRef = useRef<RenditionLike | null>(null);
  // Finger-pan bookkeeping for draw mode: in paginated flow a horizontal swipe
  // turns the page, so accumulate the drag and flip once past a threshold, with
  // a cooldown so one gesture doesn't riffle through several pages.
  const panAccum = useRef(0);
  const panLastFlip = useRef(0);
  const bookRef = useRef<BookLike | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const highlightsRef = useRef<Map<string, StoredHighlight>>(new Map());
  const [ready, setReady] = useState(false);
  // Surfaced when the book file itself can't be fetched — previously a 404/500
  // just left "Loading…" up forever with no indication anything went wrong.
  const [loadError, setLoadError] = useState<string | null>(null);
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
  // Right-click menu on plain page surface (highlights and selections
  // route to their own popovers instead — see the contextmenu hook).
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null);
  // Inline note editor floated at a highlight (opened from its menu).
  const [noteDraft, setNoteDraft] = useState<{
    h: PanelHighlight;
    noteId: string | null;
    body: string;
    x: number;
    y: number;
  } | null>(null);
  // Panel state — list of highlights and notes for this book. Mirrored
  // by highlightsRef for the rendition-paint path; React state drives
  // the panel UI.
  const [panelOpen, setPanelOpen] = useState(false);
  const [highlights, setHighlights] = useState<PanelHighlight[]>([]);
  const [notes, setNotes] = useState<PanelNote[]>([]);

  // The book's color key (color → meaning), shown as swatch tooltips and the
  // panel legend. Edited on the book detail page, read-only in here.
  const { data: keyData } = useSWR<{ key: ColorKeyMap }>(
    `/api/highlight-key?bookId=${encodeURIComponent(bookId)}`,
    fetcher,
  );
  const colorKey = keyData?.key;

  // Session-local undo stack: ids of highlights created in this reader
  // session, newest last. Ctrl+Z pops the top and deletes that highlight —
  // popover picks, highlighter-mode swipes, and highlight-and-note all land
  // here. Earlier sessions' highlights are deliberately not reachable.
  // The ref mirror lets the key handlers (created once inside the render
  // effect) call the live undo function, same pattern as createHighlightRef.
  const undoStackRef = useRef<string[]>([]);
  const undoLastHighlightRef = useRef<() => void>(() => {});

  // Draw-tool state. Drawing takes over the pointer, so it's a distinct mode
  // from reading/highlighting (which use text selection). It lives HERE and not
  // inside the overlay because a flow-mode change rebuilds the whole rendition
  // (see the main effect's dep array) and the strokes must survive that.
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
  // Bumped whenever the book moves under the overlay (page turn, re-render,
  // container resize, font step) so every stroke is re-measured against where
  // its block landed. A counter, not a flag: two moves in a row must both fire.
  const [inkRepaint, setInkRepaint] = useState(0);
  const drawModeRef = useRef(false);
  const undoInkRef = useRef<() => void>(() => {});

  // The live values for whichever instrument is selected — fed to the toolbar
  // and the overlay so drawing previews match what will be saved.
  const drawingHl = tool === "highlighter";
  const activeColor = drawingHl ? hlColor : inkColor;
  const activeWidth = drawingHl ? hlWidth : inkWidth;
  const activeOpacity = drawingHl ? HIGHLIGHTER_OPACITY : inkOpacity;

  // The rendition is rebuilt on a flow-mode change, so the overlay reads it
  // through this accessor rather than holding one by value.
  const getInkContents = useCallback((): ContentsLike[] => {
    try {
      return renditionRef.current?.getContents() ?? [];
    } catch {
      return []; // mid-teardown
    }
  }, []);

  // Highlighter mode: the reflowable-text answer to the PDF freehand
  // highlighter. With it on, selecting text applies the chosen color straight
  // away (no color popover) — swipe across the words and they're marked. It's
  // anchored to the text (CFI), not pixels, so it survives reflow/resize/font
  // changes, which a freehand stroke on reflowable text can't. Refs mirror the
  // state so the selection handlers (created once inside the render effect) read
  // the live values instead of a stale closure.
  const [highlighterMode, setHighlighterMode] = useState(false);
  const [highlighterColor, setHighlighterColor] = useState<HighlightColor>("yellow");
  const highlighterModeRef = useRef(false);
  const highlighterColorRef = useRef<HighlightColor>("yellow");
  // The 'selected' event and the mouseup fallback both fire for one selection;
  // in popover mode that's harmless (idempotent setState), but in highlighter
  // mode it would create the highlight twice. Dedupe on the CFI range.
  const lastAppliedCfiRef = useRef<string | null>(null);

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
      // The palette rgba already carries the intended 0.4 alpha. fill-opacity
      // must be an explicit 1 — combined with the rgba it used to multiply
      // down to ~0.18 (washed-out highlights), and omitting it would let
      // epub.js's own default sneak back in. multiply matches the PDF
      // reader's blend so the same color reads the same in both formats.
      {
        fill: HIGHLIGHT_COLORS[h.color].fill,
        "fill-opacity": "1",
        "mix-blend-mode": "multiply",
      },
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

  // Persist a highlight (CFI range + text + color) and paint it. Shared by the
  // popover path (saveHighlight) and highlighter mode.
  const createHighlight = useCallback(
    async (
      cfiRange: string,
      text: string,
      color: HighlightColor,
      context?: QuoteAnchorContext,
    ) => {
      // Additive: the CFI is the primary anchor; prefix/suffix/progression are
      // captured when available so the highlight can also be re-anchored by
      // text on another device. Keys are omitted (not written empty) when the
      // context couldn't be derived.
      const anchor: {
        type: string;
        cfi: string;
        prefix?: string;
        suffix?: string;
        progression?: number;
      } = { type: "epub-cfi-range", cfi: cfiRange };
      if (context?.prefix) anchor.prefix = context.prefix;
      if (context?.suffix) anchor.suffix = context.suffix;
      if (typeof context?.progression === "number") {
        anchor.progression = context.progression;
      }
      try {
        const r = await fetch("/api/highlights", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ bookId, anchor, text, color }),
        });
        if (!r.ok) return null;
        const row = (await r.json()) as StoredHighlight;
        highlightsRef.current.set(row.id, row);
        undoStackRef.current.push(row.id);
        setHighlights((prev) => [...prev, row as PanelHighlight]);
        repaintHighlight(row);
        return row;
      } catch {
        /* fail silently — user can retry */
        return null;
      }
    },
    [bookId, repaintHighlight],
  );

  // Load saved ink strokes; each paints as soon as its section is on screen and
  // its CFI resolves. Only block-anchored strokes can render in a reflowable
  // book — a page-anchored one has no page here to sit on.
  const loadInk = useCallback(async () => {
    try {
      const r = await fetch(`/api/ink?bookId=${encodeURIComponent(bookId)}`);
      if (r.ok) {
        const data = (await r.json()) as { strokes: InkStroke[] };
        setInkStrokes(data.strokes.filter((s) => s.anchor?.kind === "block"));
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
    async (cfi: string, section: number, points: InkPoint[]) => {
      const tempId = `tmp-${++inkTemp.current}`;
      // Snapshot the active instrument at commit time (strokeWidth is named to
      // avoid shadowing anything in this scope).
      const strokeKind: InkKind = tool;
      const strokeColor = drawingHl ? hlColor : inkColor;
      const strokeWidth = drawingHl ? hlWidth : inkWidth;
      const strokeOpacity = drawingHl ? HIGHLIGHTER_OPACITY : inkOpacity;
      const anchor: InkAnchor = { kind: "block", cfi, section };
      const optimistic: InkStroke = {
        id: tempId,
        // No page: a reflowable book has none. `anchor` is what fastens it.
        page: null,
        anchor,
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
            anchor,
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

  // Mirror the mode/color/create-fn into refs so the selection handlers (built
  // once, inside the render effect) always see the live values.
  const createHighlightRef = useRef(createHighlight);
  useEffect(() => {
    createHighlightRef.current = createHighlight;
  }, [createHighlight]);
  useEffect(() => {
    highlighterModeRef.current = highlighterMode;
  }, [highlighterMode]);
  useEffect(() => {
    highlighterColorRef.current = highlighterColor;
  }, [highlighterColor]);
  useEffect(() => {
    drawModeRef.current = drawMode;
  }, [drawMode]);
  useEffect(() => {
    undoInkRef.current = undoInk;
  }, [undoInk]);

  useEffect(() => {
    let cancelled = false;
    // Teardown hooks registered by the async setup below. The async IIFE
    // cannot return a cleanup to React (its return value is discarded), so
    // listeners/observers it attaches push their removal here and the OUTER
    // cleanup runs them. (The window keydown listener used to be returned
    // from the IIFE and therefore leaked on every mode switch.)
    const cleanups: Array<() => void> = [];
    const viewer = viewerRef.current;
    if (!viewer) return;

    (async () => {
      const { default: ePub } = await import("epubjs");
      if (cancelled) return;

      let response: Response;
      try {
        response = await fetch(fileUrl);
      } catch {
        if (!cancelled) setLoadError("Could not reach the server.");
        return;
      }
      if (cancelled) return;
      if (!response.ok) {
        setLoadError(
          response.status === 404
            ? "Book file not found — it may have been moved or removed."
            : `Could not load the book (server responded ${response.status}).`,
        );
        return;
      }
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

      // Two book themes, following the app's light/dark toggle. THIS is
      // why EPUB pages were dark regardless of the UI theme (and of the
      // OS / extensions): the reader injects its own styles into the
      // section iframes, and only a dark set existed. PDF pages render
      // the document's own (usually white) paper, hence the difference.
      // Theme the iframe's <html> too, not just <body>: in scroll mode
      // the iframe runs taller than the text, and a <body>-only
      // background lets the default <html> show through below the last
      // line.
      const bookFont =
        '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, system-ui, sans-serif';
      rendition.themes.register("homelab-dark", {
        html: { background: "#09090b" },
        body: {
          color: "#e4e4e7",
          background: "#09090b",
          "min-height": "100%",
          "font-family": bookFont,
          "line-height": "1.6",
        },
        a: { color: "#fbbf24" },
        "h1, h2, h3, h4, h5, h6": { color: "#fafafa" },
      });
      rendition.themes.register("homelab-light", {
        html: { background: "#fafafa" },
        body: {
          color: "#18181b",
          background: "#fafafa",
          "min-height": "100%",
          "font-family": bookFont,
          "line-height": "1.6",
        },
        a: { color: "#b45309" },
        "h1, h2, h3, h4, h5, h6": { color: "#09090b" },
      });
      rendition.themes.select(
        document.documentElement.dataset.theme === "light"
          ? "homelab-light"
          : "homelab-dark",
      );
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
      // Unmounted while highlights loaded → the outer cleanup already ran
      // (with an empty cleanups list); attaching listeners now would leak.
      if (cancelled) return;

      const onRelocated = (...args: unknown[]) => {
        const location = args[0] as
          | { start?: { cfi?: string; percentage?: number } }
          | undefined;
        const cfi = location?.start?.cfi;
        const pct = location?.start?.percentage;
        // A page turn slides the iframe under the overlay; re-measure the ink.
        setInkRepaint((n) => n + 1);
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

      // Derive the additive text-quote context (prefix/suffix + progression)
      // for a selection. The DOM Range is recovered from the CFI (the same
      // contents.range(...) the re-anchor path uses); the surrounding text is
      // pulled via standard Range boundaries and the ~32-char trimming is the
      // pure, unit-tested helper. Progression comes from the book's locations
      // index, which is generated asynchronously — it is simply omitted until
      // ready. Whole thing is best-effort: the CFI anchor never depends on it.
      const deriveQuoteContext = (
        cfiRange: string,
        contents: ContentsLike,
      ): QuoteAnchorContext => {
        const result: QuoteAnchorContext = {};
        try {
          const doc = contents.document;
          const range = contents.range(cfiRange);
          const body = doc.body;
          const beforeRange = doc.createRange();
          beforeRange.selectNodeContents(body);
          beforeRange.setEnd(range.startContainer, range.startOffset);
          const afterRange = doc.createRange();
          afterRange.selectNodeContents(body);
          afterRange.setStart(range.endContainer, range.endOffset);
          const ctx = extractQuoteContext(
            beforeRange.toString(),
            afterRange.toString(),
          );
          if (ctx.prefix) result.prefix = ctx.prefix;
          if (ctx.suffix) result.suffix = ctx.suffix;
        } catch {
          /* boundary text unavailable — CFI anchor stands alone */
        }
        try {
          const pct = bookRef.current?.locations.percentageFromCfi(cfiRange);
          // epub.js returns -1 before locations.generate() resolves; only a
          // real 0..1 fraction is meaningful.
          if (typeof pct === "number" && isFinite(pct) && pct >= 0 && pct <= 1) {
            result.progression = pct;
          }
        } catch {
          /* locations not ready — omit progression */
        }
        return result;
      };

      // Text selection → show popover with color picker.
      const showPopoverFor = (
        cfiRange: string,
        contents: ContentsLike,
      ) => {
        const sel = contents.window.getSelection();
        const text = sel?.toString() ?? "";
        if (!text.trim()) return;

        // Capture the surrounding-text context now, while the selection's DOM
        // Range is still live and resolvable.
        const context = deriveQuoteContext(cfiRange, contents);

        // Highlighter mode: apply the chosen color straight away, no popover.
        // Dedupe the near-simultaneous 'selected' + mouseup double-fire on the
        // same range, and clear the native selection so the marker stands alone.
        if (highlighterModeRef.current) {
          if (lastAppliedCfiRef.current === cfiRange) return;
          lastAppliedCfiRef.current = cfiRange;
          setTimeout(() => {
            if (lastAppliedCfiRef.current === cfiRange) lastAppliedCfiRef.current = null;
          }, 800);
          createHighlightRef.current(
            cfiRange,
            text,
            highlighterColorRef.current,
            context,
          );
          try {
            sel?.removeAllRanges();
          } catch {
            /* ignore */
          }
          return;
        }

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

        setSelection({ cfiRange, text, x, y, context });
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
      // Shared wheel accumulator across all hooked section documents so
      // continuous-mode iframes don't each keep their own throttle.
      const wheelState = { accum: 0, lastFlip: 0 };
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

        // Right-click inside the book. Native browser menu is suppressed
        // over the reading surface; what opens depends on the target:
        // an existing highlight (epub.js marks carry their data as
        // data-* attributes, so data-id resolves the record) → its
        // HighlightMenu; a live text selection → the color picker;
        // plain text → the reader menu. Coordinates are iframe-local and
        // translate by the frame's offset, same as the click callback.
        doc.addEventListener("contextmenu", (e: MouseEvent) => {
          e.preventDefault();
          const target = e.target as Element | null;
          const iframe = target?.ownerDocument?.defaultView?.frameElement as
            | HTMLIFrameElement
            | null;
          const ifr = iframe?.getBoundingClientRect();
          const x = (ifr?.left ?? 0) + e.clientX;
          const y = (ifr?.top ?? 0) + e.clientY;

          const mark = target?.closest?.("g[data-id]") as SVGGElement | null;
          const hid = mark?.dataset.id;
          if (hid && highlightsRef.current.has(hid)) {
            const h = highlightsRef.current.get(hid)!;
            setCtxMenu(null);
            setSelection(null);
            setOpenMenu({ id: h.id, color: h.color, x, y });
            return;
          }

          const sel = contents.window.getSelection();
          if (sel && sel.rangeCount > 0 && !sel.getRangeAt(0).collapsed && sel.toString().trim()) {
            const cfi = contents.cfiFromRange?.(sel.getRangeAt(0));
            if (cfi) {
              setCtxMenu(null);
              showPopoverFor(cfi, contents);
              return;
            }
          }

          setSelection(null);
          setOpenMenu(null);
          setCtxMenu({ x, y });
        });

        // Wheel turns the page in paginated mode (scrolled mode keeps
        // native scrolling). Accumulate small deltas so a trackpad
        // doesn't flip on a twitch, and throttle so one notch of
        // momentum is one turn.
        doc.addEventListener(
          "wheel",
          (e: WheelEvent) => {
            if (mode !== "paginated") return;
            e.preventDefault();
            const now = Date.now();
            if (now - wheelState.lastFlip < 400) return;
            wheelState.accum += e.deltaY;
            if (Math.abs(wheelState.accum) < 40) return;
            const forward = wheelState.accum > 0;
            wheelState.accum = 0;
            wheelState.lastFlip = now;
            if (forward) rendition.next();
            else rendition.prev();
          },
          { passive: false },
        );
      };

      // Text-quote resolution (Phase C P2). A highlight synced from another
      // device carries a text-quote anchor (surrounding text + reading position)
      // but no CFI — a CFI only means something inside THIS rendition. When a
      // section renders, fuzzy-match the quote in its DOM, turn the found range
      // into a CFI, paint the mark, and PATCH the one-time anchor upgrade so the
      // work never repeats. Unresolved highlights stay listed in the panel and
      // jump by reading percentage instead (see jumpToHighlight). Resolution is
      // on-view only (no whole-spine loop at open) and attempted at most once per
      // highlight per reader session — the tracker is rebuilt with the rendition.
      const resolutionTracker = createResolutionTracker();
      const resolveTextQuoteInSection = (
        section: SpineItemLike,
        contents: ContentsLike,
      ) => {
        const root = contents.document.body;
        if (!root) return;
        for (const h of highlightsRef.current.values()) {
          const a = h.anchor;
          // Only unresolved text-quote anchors need resolving.
          if (a.type !== "text-quote" || a.cfi || !a.quote) continue;
          // Skip sections this highlight doesn't belong to BEFORE spending its
          // single attempt, so the attempt lands in the matching chapter.
          if (
            !sectionMatchesAnchor(
              { chapterHref: a.chapterHref, progression: a.progression },
              { href: section.href },
            )
          ) {
            continue;
          }
          if (!resolutionTracker.shouldAttempt(h.id)) continue;

          let cfi: string | undefined;
          try {
            const range = toRange(root, {
              exact: a.quote,
              prefix: a.prefix,
              suffix: a.suffix,
            });
            if (!range) continue;
            // dom-anchor can return a boundary on an element (e.g. a quote that
            // starts at the very beginning of a paragraph lands on BODY offset
            // 0). epub.js derives a phantom CFI from such a boundary that will
            // not re-resolve when the mark is painted, so descend both edges
            // into their text nodes first.
            cfi = contents.cfiFromRange?.(descendRangeToText(range)) ?? undefined;
          } catch {
            // A malformed quote or a CFI failure degrades to the percent-jump.
            continue;
          }
          if (!cfi) continue;

          // Upgrade the in-memory anchor so it paints and jumps by CFI now.
          const upgraded: StoredHighlight = {
            ...h,
            anchor: { ...a, type: "epub-cfi-range", cfi },
          };
          highlightsRef.current.set(h.id, upgraded);
          setHighlights((prev) =>
            prev.map((x) => (x.id === h.id ? (upgraded as PanelHighlight) : x)),
          );
          repaintHighlight(upgraded);

          // Persist the one-time upgrade (P1 endpoint). Best-effort: if it
          // fails, the DB anchor stays text-quote and resolves again next
          // session — this session's mark still stands.
          const payload = buildUpgradePayload(cfi);
          if (payload) {
            fetch(`/api/highlights/${h.id}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(payload),
            }).catch(() => {
              /* transient */
            });
          }
        }
      };

      // On every (re-)render: hook any new section documents for the
      // selection fallback, repaint known highlights, and resolve any
      // text-quote highlights that belong to the section just rendered.
      // epubjs keeps annotations across page turns within a spine item but can
      // lose them crossing chapters, so repaint defensively.
      const onRendered = (...args: unknown[]) => {
        const section = args[0] as SpineItemLike | undefined;
        const view = args[1] as { contents?: ContentsLike } | undefined;
        for (const c of rendition.getContents()) hookSelection(c);
        for (const h of highlightsRef.current.values()) repaintHighlight(h);
        // A newly rendered section brings blocks the overlay hasn't resolved
        // its strokes against yet.
        setInkRepaint((n) => n + 1);
        if (section) {
          const contents = view?.contents ?? rendition.getContents()[0];
          if (contents) resolveTextQuoteInSection(section, contents);
        }
      };
      rendition.on("rendered", onRendered);

      // The "rendered" event for the section shown at open fired during the
      // rendition.display() above, BEFORE this listener was attached, so run one
      // resolution pass over whatever is already on screen — and hook those
      // documents too: without this, the FIRST section never gets the
      // mouseup fallback, the contextmenu listener, or the wheel handler
      // until a re-render (the 'selected' event masked the selection gap).
      for (const c of rendition.getContents()) hookSelection(c);
      for (const c of rendition.getContents()) {
        const idx = c.sectionIndex;
        const section =
          typeof idx === "number" ? book.spine?.items?.[idx] : undefined;
        if (section) resolveTextQuoteInSection(section, c);
      }

      const onKey = (e: KeyboardEvent) => {
        // Undo works in both flow modes and regardless of where focus sits —
        // window keydowns cover the outer page, the rendition relay covers
        // keydowns inside the section iframes. Text-editing targets keep the
        // browser's own undo.
        if (isUndoShortcut(e)) {
          if (isEditableTarget(e.target)) return;
          e.preventDefault();
          // Draw mode owns Ctrl+Z while it's on: the stroke just drawn is what
          // the reader means to take back, not a highlight from earlier in the
          // session. The two undo stacks never compete for the same keypress.
          if (drawModeRef.current) undoInkRef.current();
          else undoLastHighlightRef.current();
          return;
        }
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
      cleanups.push(() => window.removeEventListener("keydown", onKey));

      // The highlights panel opening/closing resizes the reading column.
      // epub.js re-measures only on WINDOW resize, so watch the container and
      // reflow the rendition when its box changes (rAF-coalesced: the observer
      // can fire in bursts while the panel mounts).
      let resizeRaf = 0;
      const ro = new ResizeObserver(() => {
        cancelAnimationFrame(resizeRaf);
        resizeRaf = requestAnimationFrame(() => {
          try {
            rendition.resize?.();
          } catch {
            /* rendition mid-teardown */
          }
          // The reflow moved every block; the ink has to follow it.
          setInkRepaint((n) => n + 1);
        });
      });
      ro.observe(viewer);
      cleanups.push(() => {
        cancelAnimationFrame(resizeRaf);
        ro.disconnect();
      });
    })();

    return () => {
      cancelled = true;
      for (const fn of cleanups) fn();
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
    // The text reflows at the new size and every block moves. Block-anchored
    // strokes ride that — re-measuring is what makes them ride it.
    setInkRepaint((n) => n + 1);
  }, [fontPercent]);

  // The book follows the app theme LIVE: the header toggle stamps
  // data-theme on <html> (ThemeToggle); watching that attribute
  // re-selects the matching book theme without a reload.
  useEffect(() => {
    const apply = () =>
      renditionRef.current?.themes.select(
        document.documentElement.dataset.theme === "light"
          ? "homelab-light"
          : "homelab-dark",
      );
    const mo = new MutationObserver(apply);
    mo.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    return () => mo.disconnect();
  }, []);

  useEffect(() => {
    writeSetting("epub.mode", mode);
  }, [mode]);

  // Dismiss popovers on outside click. Clicks inside the book land in
  // the section IFRAMES and never bubble to the outer document, so the
  // one-shot listener must attach to every section document as well —
  // otherwise clicking the page next to an open menu leaves it stuck.
  useEffect(() => {
    if (!selection && !openMenu && !ctxMenu) return;
    const onDocClick = () => {
      setSelection(null);
      setOpenMenu(null);
      setCtxMenu(null);
    };
    const docs: Document[] = [document];
    try {
      renditionRef.current?.getContents().forEach((c) => docs.push(c.document));
    } catch {
      /* rendition mid-teardown — outer document still dismisses */
    }
    // Microtask to skip the click that opened the popover.
    const t = setTimeout(
      () =>
        docs.forEach((d) => d.addEventListener("click", onDocClick, { once: true })),
      0,
    );
    return () => {
      clearTimeout(t);
      docs.forEach((d) => d.removeEventListener("click", onDocClick));
    };
  }, [selection, openMenu, ctxMenu]);

  async function saveHighlight(color: HighlightColor) {
    if (!selection) return;
    await createHighlight(
      selection.cfiRange,
      selection.text,
      color,
      selection.context,
    );
    setSelection(null);
    try {
      renditionRef.current
        ?.getContents()
        .forEach((c) => c.window.getSelection()?.removeAllRanges());
    } catch {
      /* ignore */
    }
  }

  // Highlight-and-note in ONE gesture: create the highlight (current
  // highlighter color) from the live selection, then open the note
  // editor on it immediately — no re-click required.
  async function saveHighlightAndNote() {
    if (!selection) return;
    const { x, y } = selection;
    const row = await createHighlight(
      selection.cfiRange,
      selection.text,
      highlighterColor,
      selection.context,
    );
    setSelection(null);
    try {
      renditionRef.current
        ?.getContents()
        .forEach((c) => c.window.getSelection()?.removeAllRanges());
    } catch {
      /* ignore */
    }
    if (!row) return;
    setNoteDraft({ h: row as PanelHighlight, noteId: null, body: "", x, y });
  }

  function discardSelection() {
    setSelection(null);
    try {
      renditionRef.current
        ?.getContents()
        .forEach((c) => c.window.getSelection()?.removeAllRanges());
    } catch {
      /* ignore */
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

  const deleteHighlight = useCallback(async (id: string) => {
    const h = highlightsRef.current.get(id);
    try {
      await fetch(`/api/highlights/${id}`, { method: "DELETE" });
      highlightsRef.current.delete(id);
      // A hand-deleted highlight leaves the undo stack too, so Ctrl+Z never
      // re-deletes something already gone.
      undoStackRef.current = undoStackRef.current.filter((x) => x !== id);
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
  }, []);

  // Ctrl+Z: delete the most recent highlight created this session. Skips past
  // stack entries that no longer exist (already deleted by hand) instead of
  // dying on them.
  const undoLastHighlight = useCallback(() => {
    const stack = undoStackRef.current;
    let id = stack.pop();
    while (id && !highlightsRef.current.has(id)) id = stack.pop();
    if (id) deleteHighlight(id);
  }, [deleteHighlight]);
  useEffect(() => {
    undoLastHighlightRef.current = undoLastHighlight;
  }, [undoLastHighlight]);

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
            // Bind structurally to the highlight (not just by CFI), so the
            // pairing survives even if the CFI later shifts.
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
    const rendition = renditionRef.current;
    if (!rendition) return;
    // A resolved highlight jumps to its exact CFI. An unresolved text-quote
    // highlight degrades to its reading percentage, mapped through the book's
    // locations index. With neither, the jump is a no-op and the entry simply
    // stays listed in the panel.
    const target = jumpTarget(h.anchor);
    if (target.kind === "cfi") {
      rendition.display(target.cfi);
    } else if (target.kind === "percent") {
      try {
        const cfi = bookRef.current?.locations.cfiFromPercentage(
          target.progression,
        );
        if (cfi) rendition.display(cfi);
      } catch {
        /* locations not ready — leave the entry listed, do nothing */
      }
    }
  }

  // From the highlight menu's note action: open the note editor at the
  // highlight, pre-filled if it already has a note.
  function openNoteEditor() {
    if (!openMenu) return;
    const hl = highlightsRef.current.get(openMenu.id);
    if (!hl) return;
    const existing = notes.find((n) => n.highlightId === openMenu.id) ?? null;
    setNoteDraft({
      h: hl as PanelHighlight,
      noteId: existing?.id ?? null,
      body: existing?.body ?? "",
      x: openMenu.x,
      y: openMenu.y,
    });
    setOpenMenu(null);
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
            onClick={() => {
              setDrawMode((v) => !v);
              setErasing(false);
              // The two modes both want the pointer, and the ink overlay wins
              // (it covers the text), which would leave the highlighter a dead
              // toggle. Turning it off says so plainly.
              setHighlighterMode(false);
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
          {/* Highlighter: a toggle, plus a color strip while it's on. With it
              on, selecting text marks it in the chosen color — no popover. */}
          <div className="flex items-center gap-1.5">
            {highlighterMode && (
              <div className="flex items-center gap-1">
                {(Object.keys(HIGHLIGHT_COLORS) as HighlightColor[]).map((c) => (
                  <button
                    key={c}
                    aria-label={
                      colorKey?.[c]
                        ? `${HIGHLIGHT_COLORS[c].label} — ${colorKey[c]}`
                        : HIGHLIGHT_COLORS[c].label
                    }
                    title={
                      colorKey?.[c]
                        ? `${HIGHLIGHT_COLORS[c].label} — ${colorKey[c]}`
                        : HIGHLIGHT_COLORS[c].label
                    }
                    aria-pressed={highlighterColor === c}
                    onClick={() => setHighlighterColor(c)}
                    className={`h-4 w-4 rounded-full ring-1 ring-white/15 transition-transform hover:scale-110 ${
                      highlighterColor === c ? "ring-2 ring-zinc-100" : ""
                    }`}
                    style={{ background: HIGHLIGHT_COLORS[c].swatch }}
                  />
                ))}
              </div>
            )}
            <button
              onClick={() => setHighlighterMode((v) => !v)}
              aria-label="Highlighter"
              aria-pressed={highlighterMode}
              title={
                highlighterMode
                  ? "Highlighter on — select text to mark it"
                  : "Highlighter — select text to mark it"
              }
              className={`rounded p-1.5 transition-colors ${
                highlighterMode
                  ? "bg-amber-500/20 text-amber-400"
                  : "text-zinc-500 hover:bg-zinc-900 hover:text-zinc-200"
              }`}
            >
              <Highlighter size={14} />
            </button>
          </div>
          <ThemeToggle />
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
          <div
            // The reading-position pager. A test hook, not just cosmetics: its
            // text is "Loading…" until the rendition displays, so it — and NOT
            // the font-size chip, which reads "100%" from first paint — is the
            // signal that epub.js has actually rendered.
            data-testid="epub-pager"
            className="text-xs text-zinc-600 tabular-nums"
          >
            {loadError ? "—" : ready ? `${Math.round(percent * 100)}%` : "Loading…"}
          </div>
        </div>
      </header>

      {/* Mounting this band shrinks the reading row, which trips the container
          ResizeObserver and reflows the book the moment Draw turns on. That is
          the design working, not a bug: the strokes are fastened to blocks and
          ride the reflow — which is exactly why they can't be fastened to
          pixels. */}
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

      {/* Reading row: surface and highlights panel side by side, so the open
          panel pushes the book text aside instead of covering it. The panel
          falls back to overlaying at phone widths (see HighlightsPanel); the
          relative wrapper is its positioning box for that case. */}
      <div className="relative flex min-h-0 flex-1">
        {/* overscroll-contain stops a pan that reaches the end of the book from
            chaining out to the document, which is what drags the browser's own
            chrome down on a tablet — epub.js scrolls its own container inside
            this box, and the chain out of it stops here. touch-none while
            drawing belongs on this container rather than on the ink overlay: the
            overlay only owns the surface while draw mode is on, and a palm or a
            stray finger landing in the margin beside a section would otherwise
            still pan the view out from under the stroke. */}
        <div
          className={`relative flex-1 overflow-hidden overscroll-contain ${
            drawMode ? "touch-none" : ""
          }`}
          // The reading surface outside the section iframes (margins, gaps).
          // Same right-click policy as inside the book: app menu, not the
          // browser's. Marks and selections live inside the iframes, so
          // only the reader menu is reachable from out here.
          onContextMenu={(e) => {
            e.preventDefault();
            setSelection(null);
            setOpenMenu(null);
            setCtxMenu({ x: e.clientX, y: e.clientY });
          }}
        >
          <div ref={viewerRef} className="h-full w-full" />

          {/* ONE overlay across the whole surface, a sibling of the viewer
              rather than one per view: a stroke's screen position comes from
              its own block's rect plus the section frame's offset, which is
              correct in both flow modes, and strokes in off-page columns land
              outside this box and are clipped by the parent for free. */}
          <EpubInkLayer
            strokes={inkStrokes}
            getContents={getInkContents}
            repaintKey={inkRepaint}
            drawMode={drawMode}
            erasing={erasing}
            color={activeColor}
            width={activeWidth}
            opacity={activeOpacity}
            kind={tool}
            onCommit={saveStroke}
            onErase={eraseStroke}
            onPan={(dx, dy) => {
              if (mode === "scrolled") {
                // Continuous flow scrolls its own container; pan it directly.
                const sc = viewerRef.current?.querySelector<HTMLElement>(".epub-container");
                if (sc) sc.scrollTop -= dy;
                return;
              }
              // Paginated: a horizontal swipe turns the page (right → previous).
              panAccum.current += dx;
              const now = performance.now();
              if (Math.abs(panAccum.current) > 60 && now - panLastFlip.current > 400) {
                const back = panAccum.current > 0;
                panAccum.current = 0;
                panLastFlip.current = now;
                if (back) renditionRef.current?.prev();
                else renditionRef.current?.next();
              }
            }}
          />

          {loadError && (
            <div className="absolute inset-0 z-20 flex items-center justify-center bg-zinc-950/80">
              <p className="max-w-sm rounded-md border border-red-900/50 bg-zinc-900 px-4 py-3 text-center text-sm text-red-300">
                {loadError}
              </p>
            </div>
          )}

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

        <HighlightsPanel
          open={panelOpen}
          onClose={() => setPanelOpen(false)}
          highlights={highlights}
          notes={notes}
          colorKey={colorKey}
          onJump={jumpToHighlight}
          onColorChange={changeColor}
          onDelete={deleteHighlight}
          onNoteSave={saveNote}
          onNoteDelete={deleteNote}
        />
      </div>

      <div className="h-0.5 w-full bg-zinc-900">
        <div
          className="h-full bg-amber-500/70 transition-[width] duration-200"
          style={{ width: `${(percent * 100).toFixed(2)}%` }}
        />
      </div>

      {selection && (
        <HighlightMenu
          x={selection.x}
          y={selection.y}
          colorKey={colorKey}
          onPick={(c) => saveHighlight(c)}
          onAddNote={saveHighlightAndNote}
          onDelete={discardSelection}
        />
      )}

      {openMenu && (
        <HighlightMenu
          x={openMenu.x}
          y={openMenu.y}
          activeColor={openMenu.color}
          hasNote={notes.some((n) => n.highlightId === openMenu.id)}
          colorKey={colorKey}
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
              onSelect: () => renditionRef.current?.prev(),
              disabled: mode !== "paginated",
            },
            {
              label: "Next page",
              icon: <ChevronRight size={14} />,
              onSelect: () => renditionRef.current?.next(),
              disabled: mode !== "paginated",
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
              label: "Text smaller",
              icon: <ZoomOut size={14} />,
              onSelect: () => setFontPercent((p) => stepFont(p, -1)),
            },
            {
              label: "Text larger",
              icon: <ZoomIn size={14} />,
              onSelect: () => setFontPercent((p) => stepFont(p, 1)),
            },
            "divider",
            {
              label: highlighterMode ? "Highlighter off" : "Highlighter",
              icon: <Highlighter size={14} />,
              active: highlighterMode,
              onSelect: () => setHighlighterMode((v) => !v),
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

    </div>
  );
}

