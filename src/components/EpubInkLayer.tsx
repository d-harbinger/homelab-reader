"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { hasSeenPen, inkPointerDraws, inkPointerPans, notePointerType } from "@/lib/ink-pointer";
import {
  INK_VB,
  hasPressureVariation,
  inkPath,
  inkSegments,
  placeInkStroke,
  unionRect,
  type InkKind,
  type InkPlacement,
  type InkPoint,
  type InkRectLike,
  type InkStroke,
} from "@/lib/ink";

// The slice of epub.js's Contents this overlay needs. Structural, so the
// reader's own ContentsLike satisfies it without either file importing the
// other. cfiFromNode is typed as the STRING it actually returns — epub.js's
// JSDoc claims an EpubCFI, but the implementation calls .toString() on it.
export interface InkContents {
  document: Document;
  range(cfi: string): Range | null;
  cfiFromNode?(node: Node, ignoreClass?: string): string;
  sectionIndex?: number;
}

interface Props {
  /** Every block-anchored stroke for the book; the overlay renders the ones it
   *  can currently resolve and silently ignores the rest. */
  strokes: InkStroke[];
  /** Live accessor for the rendition's contents — the rendition is rebuilt on a
   *  flow-mode change, so it can't be passed by value. */
  getContents: () => InkContents[];
  /** Bumped by the reader whenever the book moves under the overlay. */
  repaintKey: number;
  drawMode: boolean;
  erasing: boolean;
  color: string;
  width: number;
  opacity: number;
  kind: InkKind;
  onCommit: (cfi: string, section: number, points: InkPoint[]) => void;
  onErase: (id: string) => void;
  // A non-drawing finger drag pans the book (scroll or page-turn) instead of
  // drawing, so the reader can move while the pen is active. The overlay keeps
  // touch-action:none for the pen, so this is delegated to the reader in JS.
  onPan?: (dx: number, dy: number) => void;
}

// A highlighter reads like a real marker: a broad, FLAT-tipped, multiply-blended
// swipe. A pen is opaque with a round nib. Same two instruments as the PDF
// overlay, and deliberately the same look.
const HIGHLIGHTER_CAP = "butt" as const;
const PEN_CAP = "round" as const;

// The block a stroke is fastened to, measured on the outer viewport.
interface BlockHit {
  cfi: string;
  section: number;
  rects: InkRectLike[];
}

interface Placed {
  stroke: InkStroke;
  placement: InkPlacement;
}

// The section iframe spans EVERY column and slides left as the container
// scrolls — epub.js pages by `container.scrollLeft += layout.delta`, not by a
// transform. So adding the frame's own offset to a rect measured inside it is
// the entire viewport conversion, at any scroll offset, in either flow mode. No
// page-index arithmetic, and columns that are off-page land outside the overlay
// and are clipped by its overflow-hidden parent for free. The reader uses this
// same trick to float its highlight popovers.
function toViewport(rects: DOMRect[], frame: DOMRect): InkRectLike[] {
  return rects.map((r) => ({
    x: frame.left + r.left,
    y: frame.top + r.top,
    width: r.width,
    height: r.height,
  }));
}

function frameRectOf(c: InkContents): DOMRect | null {
  const frame = c.document.defaultView?.frameElement as HTMLIFrameElement | null;
  return frame?.getBoundingClientRect() ?? null;
}

// Walk up to the nearest element that forms a block box. `display: inline` is
// the one thing that can't own a stroke: an inline box fragments per LINE, so
// its rects describe a sentence rather than the paragraph a mark was drawn
// across. Stops below <html>, which is the whole section and no kind of anchor.
function nearestBlock(start: Element | null, doc: Document): Element | null {
  const win = doc.defaultView;
  let el: Element | null = start;
  while (el && el !== doc.documentElement) {
    const display = win?.getComputedStyle(el).display;
    if (display && display !== "inline" && display !== "contents") return el;
    el = el.parentElement;
  }
  return null;
}

// Resolve a block CFI back to the element's on-screen fragments.
//
// contents.range() on a NODE cfi hands back a range collapsed AT the element
// (epub.js only calls setEnd for a range cfi), so the element is its
// startContainer — and the rects have to come off the element, not the range,
// which being collapsed has none. getClientRects gives one rect per fragment;
// getBoundingClientRect would give the union spanning the column gap, which is
// useless for deciding which column a mark belongs in.
function measureBlock(c: InkContents, cfi: string): InkRectLike[] | null {
  const frame = frameRectOf(c);
  if (!frame) return null;
  let el: Element | null;
  try {
    const start = c.range(cfi)?.startContainer;
    if (!start) return null;
    el =
      start.nodeType === Node.ELEMENT_NODE
        ? (start as Element)
        : start.parentElement;
  } catch {
    return null;
  }
  if (!el) return null;
  const rects = toViewport(Array.from(el.getClientRects()), frame);
  return rects.length > 0 ? rects : null;
}

/**
 * ONE SVG overlay across the whole reading surface — not one per view. The
 * viewport conversion above makes a single surface-wide overlay correct in both
 * flow modes, and it survives epub.js swapping views underneath it.
 *
 * Coordinates are overlay-local px, NOT the PDF overlay's fixed 0..1000 viewBox:
 * a stroke here scales from the box of the BLOCK it is fastened to, and every
 * block has a different one. The stored points stay 0..1 fractions of that
 * block, and a per-stroke transform maps them onto wherever the block landed
 * this reflow.
 */
export function EpubInkLayer({
  strokes,
  getContents,
  repaintKey,
  drawMode,
  erasing,
  color,
  width,
  opacity,
  kind,
  onCommit,
  onErase,
  onPan,
}: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [placed, setPlaced] = useState<Placed[]>([]);
  // A live finger-pan gesture: last client position, so each move pans by the
  // delta since the previous sample.
  const panLast = useRef<{ x: number; y: number } | null>(null);
  // The block the in-progress stroke is being drawn on, fixed at pointerdown:
  // its box is the fraction space the points are recorded in, and re-measuring
  // mid-stroke would move the ink out from under the pen.
  const activeRef = useRef<{
    hit: BlockHit;
    union: InkRectLike;
    placement: InkPlacement;
  } | null>(null);
  const drawing = useRef(false);
  // `current` drives the in-progress render; `latest` is the same points in a
  // ref so the commit reads them WITHOUT a side effect inside a setState
  // updater — React StrictMode double-invokes updaters in dev, which fired the
  // PDF overlay's save (and its POST) twice.
  const latest = useRef<InkPoint[] | null>(null);
  const [current, setCurrent] = useState<{
    points: InkPoint[];
    placement: InkPlacement;
  } | null>(null);

  // Re-resolve every stroke against where its block sits right now. Each stroke
  // is independent: one CFI that no longer resolves is skipped and the rest of
  // the overlay still paints.
  const measure = useCallback(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const surface = svg.getBoundingClientRect();
    let contents: InkContents[];
    try {
      contents = getContents();
    } catch {
      return; // rendition mid-teardown — keep the last paint rather than blank
    }
    const next: Placed[] = [];
    for (const stroke of strokes) {
      const anchor = stroke.anchor;
      if (!anchor || anchor.kind !== "block") continue;
      // The cheap integer pre-filter before spending a CFI resolve: a stroke
      // whose section isn't rendered can't be on screen.
      const c = contents.find((x) => x.sectionIndex === anchor.section);
      if (!c) continue;
      const rects = measureBlock(c, anchor.cfi);
      if (!rects) continue;
      const origin = stroke.points[0];
      if (!origin) continue;
      const placement = placeInkStroke(
        rects,
        origin[0],
        origin[1],
        surface.left,
        surface.top,
      );
      if (placement) next.push({ stroke, placement });
    }
    setPlaced(next);
  }, [strokes, getContents]);

  useEffect(() => {
    // Measure now so a just-committed stroke paints in this frame, then again on
    // the next one: 'rendered' and 'relocated' fire before the columns epub.js
    // just built have their final boxes.
    measure();
    const raf = requestAnimationFrame(measure);
    return () => cancelAnimationFrame(raf);
  }, [measure, repaintKey]);

  useEffect(() => {
    const surface = svgRef.current?.parentElement;
    if (!surface) return;
    let raf = 0;
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(measure);
    };
    // Scroll events don't bubble, but they DO run the capture phase down to the
    // target — so this one listener catches the container epub.js scrolls in
    // scrolled mode, where the iframes slide under a fixed overlay.
    surface.addEventListener("scroll", onScroll, true);
    return () => {
      cancelAnimationFrame(raf);
      surface.removeEventListener("scroll", onScroll, true);
    };
  }, [measure]);

  // What did the pen land on? The overlay swallowed the pointer, so the section
  // document has to be asked directly.
  const blockAt = useCallback(
    (clientX: number, clientY: number): BlockHit | null => {
      let contents: InkContents[];
      try {
        contents = getContents();
      } catch {
        return null;
      }
      for (const c of contents) {
        const frame = frameRectOf(c);
        if (!frame) continue;
        if (
          clientX < frame.left ||
          clientX > frame.right ||
          clientY < frame.top ||
          clientY > frame.bottom
        ) {
          continue;
        }
        const section = c.sectionIndex;
        if (typeof section !== "number") continue;
        try {
          // The iframe never scrolls internally (the CONTAINER does), so the
          // frame's offset is the only correction elementFromPoint needs.
          const hit = c.document.elementFromPoint(
            clientX - frame.left,
            clientY - frame.top,
          );
          const block = nearestBlock(hit, c.document);
          if (!block) continue;
          const cfi = c.cfiFromNode?.(block);
          if (!cfi) continue;
          const rects = toViewport(Array.from(block.getClientRects()), frame);
          if (rects.length === 0) continue;
          return { cfi, section, rects };
        } catch {
          continue; // section mid-teardown; try the next one
        }
      }
      return null;
    },
    [getContents],
  );

  // Fractions of the block's UNION box — the same space placeInkStroke paints
  // back into, which is what makes capture and render exact inverses, so a
  // stroke stays precisely where it was drawn until something reflows.
  //
  // Position is NOT clamped to 0..1: the block is a reference frame, not a cage,
  // and a freehand stroke routinely runs past the small block it started on onto
  // the rest of the page. Clamping pinned every outside point to the block edge,
  // so the ink slid straight along an invisible boundary instead of following
  // the pen. The placement geometry already maps out-of-range fractions back
  // onto the page correctly (pickFragment/placeInkStroke), and /api/ink persists
  // them un-clamped for block strokes, so the freed mark survives a reload.
  const toPoint = useCallback(
    (
      u: InkRectLike,
      clientX: number,
      clientY: number,
      pressure: number,
      type: string,
    ): InkPoint => [
      (clientX - u.x) / u.width,
      (clientY - u.y) / u.height,
      type === "pen" && pressure > 0 ? pressure : 0.5,
    ],
    [],
  );

  // Drop the in-progress stroke without committing it.
  const cancelStroke = useCallback(() => {
    drawing.current = false;
    latest.current = null;
    activeRef.current = null;
    setCurrent(null);
  }, []);

  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!drawMode || erasing) return;
    notePointerType(e.pointerType);
    // A second pointer landing while a stroke is live — a palm settling, a hand
    // steadying the tablet — is never a continuation of it. Throw the stroke
    // away rather than let the next move drag a line across the block to
    // wherever the new pointer touched down.
    if (drawing.current) {
      cancelStroke();
      return;
    }
    if (!inkPointerDraws(e.pointerType, e.isPrimary, hasSeenPen())) {
      // Not the drawing instrument. A finger (once a stylus is in play) pans the
      // book instead — without this the reader can't move while the pen is on.
      if (onPan && inkPointerPans(e.pointerType, e.isPrimary, hasSeenPen())) {
        panLast.current = { x: e.clientX, y: e.clientY };
        svgRef.current?.setPointerCapture(e.pointerId);
      }
      return;
    }
    const svg = svgRef.current;
    if (!svg) return;
    const hit = blockAt(e.clientX, e.clientY);
    // Nothing to fasten to (the margin outside every section, or a block whose
    // CFI won't compute) — better to no-op than to save a stroke that can never
    // be resolved back.
    if (!hit) return;
    const union = unionRect(hit.rects);
    if (!union || !(union.width > 0) || !(union.height > 0)) return;
    const surface = svg.getBoundingClientRect();

    e.preventDefault();
    svg.setPointerCapture(e.pointerId);
    const first = toPoint(union, e.clientX, e.clientY, e.pressure, e.pointerType);
    const placement = placeInkStroke(
      hit.rects,
      first[0],
      first[1],
      surface.left,
      surface.top,
    );
    if (!placement) return;
    activeRef.current = { hit, union, placement };
    drawing.current = true;
    latest.current = [first];
    setCurrent({ points: [first], placement });
  };

  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (panLast.current) {
      const dx = e.clientX - panLast.current.x;
      const dy = e.clientY - panLast.current.y;
      panLast.current = { x: e.clientX, y: e.clientY };
      onPan?.(dx, dy);
      return;
    }
    if (!drawing.current) return;
    e.preventDefault();
    const native = e.nativeEvent as PointerEvent;
    const coalesced =
      typeof native.getCoalescedEvents === "function" ? native.getCoalescedEvents() : [];
    const src = coalesced.length ? coalesced : [native];
    const cur = latest.current;
    const active = activeRef.current;
    if (!cur || !active) return;
    const next = cur.slice();
    for (const ev of src) {
      const pt = toPoint(active.union, ev.clientX, ev.clientY, ev.pressure, ev.pointerType);
      const last = next[next.length - 1];
      const dx = (pt[0] - last[0]) * INK_VB;
      const dy = (pt[1] - last[1]) * INK_VB;
      if (dx * dx + dy * dy < 4) continue; // drop sub-2-unit jitter
      next.push(pt);
    }
    latest.current = next;
    setCurrent({ points: next, placement: active.placement });
  };

  const endStroke = () => {
    panLast.current = null; // a finger-pan ends the same way a stroke does
    if (!drawing.current) return;
    drawing.current = false;
    const pts = latest.current;
    const active = activeRef.current;
    latest.current = null;
    activeRef.current = null;
    setCurrent(null);
    // Commit OUTSIDE any setState updater.
    if (pts && pts.length && active) {
      onCommit(active.hit.cfi, active.hit.section, pts);
    }
  };

  return (
    <svg
      ref={svgRef}
      className="absolute inset-0 z-30 h-full w-full"
      style={{
        touchAction: "none",
        // Not a hit-test target unless drawing, so reading, text selection,
        // highlight clicks, and the page arrows all pass straight through.
        pointerEvents: drawMode ? "auto" : "none",
        cursor: erasing ? "cell" : drawMode ? "crosshair" : "default",
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endStroke}
      onPointerCancel={endStroke}
      aria-hidden="true"
    >
      {placed.map((p) => (
        <PlacedStroke
          key={p.stroke.id}
          placed={p}
          erasing={erasing}
          onErase={onErase}
        />
      ))}
      {current && (
        <InkGroup placement={current.placement}>
          <path
            d={inkPath(current.points)}
            stroke={color}
            strokeWidth={width * current.placement.strokeScale}
            opacity={opacity}
            fill="none"
            strokeLinecap={kind === "highlighter" ? HIGHLIGHTER_CAP : PEN_CAP}
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
            style={{
              pointerEvents: "none",
              mixBlendMode: kind === "highlighter" ? "multiply" : undefined,
            }}
          />
        </InkGroup>
      )}
    </svg>
  );
}

/**
 * Maps a stroke's 0..1 fractions onto its block's box.
 *
 * The scale is anisotropic — a block reflows to a new width AND height, and the
 * mark has to ride both. That would drag the nib's width along with it and turn
 * a round pen oval on any block that isn't square, so every stroke inside is
 * drawn with vector-effect="non-scaling-stroke" and a width already in px: the
 * geometry stretches, the nib never does.
 */
function InkGroup({
  placement,
  children,
}: {
  placement: InkPlacement;
  children: React.ReactNode;
}) {
  // React's useId deliberately emits colons so its ids can't be used as CSS
  // selectors; a url(#...) reference is one, so strip them.
  const clipId = `ink-clip-${useId().replace(/:/g, "")}`;
  const g = (
    <g
      transform={`translate(${placement.x} ${placement.y}) scale(${
        placement.width / INK_VB
      } ${placement.height / INK_VB})`}
    >
      {children}
    </g>
  );
  // An untorn block is never clipped: its box IS the union, so a clip would do
  // nothing but shave the half-nib of a stroke riding the block's edge.
  if (!placement.torn) return g;
  return (
    <g clipPath={`url(#${clipId})`}>
      <defs>
        <clipPath id={clipId}>
          <rect
            x={placement.clipX}
            y={placement.clipY}
            width={placement.clipWidth}
            height={placement.clipHeight}
          />
        </clipPath>
      </defs>
      {g}
    </g>
  );
}

function PlacedStroke({
  placed,
  erasing,
  onErase,
}: {
  placed: Placed;
  erasing: boolean;
  onErase: (id: string) => void;
}) {
  const { stroke, placement } = placed;
  const isHighlighter = stroke.kind === "highlighter";
  // A highlighter is a uniform, flat-tipped, multiply-blended swipe — pressure
  // variation and round caps are a pen concern, so it renders as one flat path.
  const variable = !isHighlighter && hasPressureVariation(stroke.points);
  const px = (n: number) => n * placement.strokeScale;
  return (
    <InkGroup placement={placement}>
      {/* Opacity applies at the GROUP level: a pressure stroke is many opaque
          overlapping round-capped segments, and per-segment alpha would visibly
          double up at every joint. Strokes saved before the field existed carry
          opacity 1. */}
      <g
        opacity={stroke.opacity ?? 1}
        style={{ mixBlendMode: isHighlighter ? "multiply" : undefined }}
      >
        {variable ? (
          inkSegments(stroke.points, stroke.width).map((seg, i) => (
            <path
              key={i}
              d={seg.d}
              stroke={stroke.color}
              strokeWidth={px(seg.w)}
              fill="none"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
              style={{ pointerEvents: "none" }}
            />
          ))
        ) : (
          <path
            d={inkPath(stroke.points)}
            stroke={stroke.color}
            strokeWidth={px(stroke.width)}
            fill="none"
            strokeLinecap={isHighlighter ? HIGHLIGHTER_CAP : PEN_CAP}
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
            style={{ pointerEvents: "none" }}
          />
        )}
        {/* Fat invisible hit target — only live while erasing, so it never
            blocks drawing over an existing stroke. */}
        <path
          d={inkPath(stroke.points)}
          stroke="transparent"
          strokeWidth={Math.max(px(stroke.width) * 3, 14)}
          fill="none"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
          style={{ pointerEvents: erasing ? "stroke" : "none", cursor: "cell" }}
          onPointerDown={
            erasing
              ? (e) => {
                  e.stopPropagation();
                  onErase(stroke.id);
                }
              : undefined
          }
        />
      </g>
    </InkGroup>
  );
}
