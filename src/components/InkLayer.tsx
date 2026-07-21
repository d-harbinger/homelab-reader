"use client";

import { useRef, useState, useCallback } from "react";
import { hasSeenPen, inkPointerDraws, inkPointerPans, notePointerType } from "@/lib/ink-pointer";
import {
  INK_VB,
  inkPath,
  inkSegments,
  hasPressureVariation,
  pointerLeftBox,
  type InkStroke,
  type InkKind,
  type InkPoint,
} from "@/lib/ink";

// How far past the page edge the pen may stray before the stroke is ended.
// A PDF page is the whole canvas, so a mark that leaves it is finished; this
// slop just keeps hand jitter right at the edge from cutting a stroke short.
const PAGE_EDGE_SLOP = 6;

interface Props {
  strokes: InkStroke[]; // saved strokes for THIS page
  drawMode: boolean;
  erasing: boolean;
  color: string;
  width: number;
  opacity: number;
  kind: InkKind; // instrument for the in-progress stroke (pen | highlighter)
  onCommit: (points: InkPoint[]) => void; // a finished stroke — parent persists
  onErase: (id: string) => void;
  // A non-drawing finger drag (the tablet-holding hand, once a stylus has been
  // seen) pans the reading surface instead of drawing. The overlay keeps
  // touch-action:none so the pen still draws, so this scroll is done in JS.
  onPan?: (dx: number, dy: number) => void;
}

// A highlighter reads like a real marker: a broad, FLAT-tipped swipe that
// multiply-blends so the text underneath shows through. A pen is opaque with a
// round nib. This is the one visual difference the two instruments carry.
const HIGHLIGHTER_CAP = "butt" as const;
const PEN_CAP = "round" as const;
function blendFor(kind: InkKind): "multiply" | undefined {
  return kind === "highlighter" ? "multiply" : undefined;
}

function clamp01(n: number): number {
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

// A per-page SVG overlay. In Draw mode it captures the pointer and builds a
// stroke in page-fraction coordinates; otherwise it ignores pointer events so
// reading, text selection, and highlight clicks pass straight through.
export function InkLayer({
  strokes,
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
  const rectRef = useRef<DOMRect | null>(null);
  const drawing = useRef(false);
  // A live finger-pan gesture: last client position, so each move scrolls by
  // the delta since the previous sample.
  const panLast = useRef<{ x: number; y: number } | null>(null);
  // A live erase drag: the eraser sweeps over strokes rather than tapping one.
  const erasingDrag = useRef(false);

  // Delete every stroke whose hit target sits under the eraser right now.
  // elementsFromPoint reads the real rendered geometry, so it works the same in
  // both readers regardless of the stroke's coordinate space, and — unlike
  // per-stroke pointer handlers — it survives touch's implicit pointer capture.
  const eraseAt = useCallback(
    (clientX: number, clientY: number) => {
      for (const el of document.elementsFromPoint(clientX, clientY)) {
        const id = el.getAttribute("data-ink-id");
        if (id) onErase(id);
      }
    },
    [onErase],
  );
  // `current` drives the in-progress render; `latest` is the same points held in
  // a ref so the commit reads them WITHOUT a side effect inside a setState
  // updater — React StrictMode double-invokes updaters in dev, and committing
  // there fired the save (and its network POST) twice.
  const latest = useRef<InkPoint[] | null>(null);
  const [current, setCurrent] = useState<InkPoint[] | null>(null);

  const toPoint = useCallback(
    (clientX: number, clientY: number, pressure: number, type: string): InkPoint => {
      const r = rectRef.current;
      if (!r) return [0, 0, 0.5];
      const p = type === "pen" && pressure > 0 ? pressure : 0.5;
      return [clamp01((clientX - r.left) / r.width), clamp01((clientY - r.top) / r.height), p];
    },
    [],
  );

  // Drop the in-progress stroke without committing it.
  const cancelStroke = () => {
    drawing.current = false;
    latest.current = null;
    setCurrent(null);
  };

  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!drawMode) return;
    if (erasing) {
      // Begin an erase sweep: capture so moves keep coming even off the page,
      // then delete whatever is under the first touch too.
      e.preventDefault();
      erasingDrag.current = true;
      svgRef.current?.setPointerCapture(e.pointerId);
      eraseAt(e.clientX, e.clientY);
      return;
    }
    notePointerType(e.pointerType);
    // A second pointer landing while a stroke is live — a palm settling, a hand
    // steadying the tablet — is never a continuation of it. Throw the stroke
    // away rather than let the next move drag a line across the page to
    // wherever the new pointer touched down.
    if (drawing.current) {
      cancelStroke();
      return;
    }
    if (!inkPointerDraws(e.pointerType, e.isPrimary, hasSeenPen())) {
      // Not the drawing instrument. A finger (once a stylus is in play) pans the
      // page instead — the overlay owns the surface in draw mode, so without
      // this the page can't scroll while the pen is active.
      if (onPan && inkPointerPans(e.pointerType, e.isPrimary, hasSeenPen())) {
        panLast.current = { x: e.clientX, y: e.clientY };
        svgRef.current?.setPointerCapture(e.pointerId);
      }
      return;
    }
    e.preventDefault();
    rectRef.current = svgRef.current?.getBoundingClientRect() ?? null;
    svgRef.current?.setPointerCapture(e.pointerId);
    drawing.current = true;
    const first = [toPoint(e.clientX, e.clientY, e.pressure, e.pointerType)];
    latest.current = first;
    setCurrent(first);
  };

  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (erasingDrag.current) {
      eraseAt(e.clientX, e.clientY);
      return;
    }
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
    const r = rectRef.current;
    if (!cur || !r) return;
    const next = cur.slice();
    // Once the pen leaves the page, the stroke is done: append the in-page
    // samples up to the crossing, then end it at the edge. Clamping past-edge
    // points instead would smear a flat line along the page boundary — the same
    // artifact the block-anchor cage caused on EPUB. PDF ink belongs to one page.
    let left = false;
    for (const ev of src) {
      if (pointerLeftBox(ev.clientX, ev.clientY, r, PAGE_EDGE_SLOP)) {
        left = true;
        break;
      }
      const pt = toPoint(ev.clientX, ev.clientY, ev.pressure, ev.pointerType);
      const last = next[next.length - 1];
      const dx = (pt[0] - last[0]) * INK_VB;
      const dy = (pt[1] - last[1]) * INK_VB;
      if (dx * dx + dy * dy < 4) continue; // drop sub-2-unit jitter
      next.push(pt);
    }
    latest.current = next;
    setCurrent(next);
    if (left) endStroke();
  };

  const endStroke = () => {
    panLast.current = null; // a finger-pan ends the same way a stroke does
    erasingDrag.current = false; // and so does an erase sweep
    if (!drawing.current) return;
    drawing.current = false;
    const pts = latest.current;
    latest.current = null;
    setCurrent(null);
    if (pts && pts.length) onCommit(pts); // commit OUTSIDE any setState updater
  };

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${INK_VB} ${INK_VB}`}
      preserveAspectRatio="none"
      className="absolute inset-0 z-20 h-full w-full"
      style={{
        touchAction: "none",
        pointerEvents: drawMode ? "auto" : "none",
        cursor: erasing ? "cell" : drawMode ? "crosshair" : "default",
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endStroke}
      onPointerCancel={endStroke}
      aria-hidden="true"
    >
      {strokes.map((s) => (
        <SavedStroke key={s.id} stroke={s} erasing={erasing} />
      ))}
      {current && (
        <path
          d={inkPath(current)}
          stroke={color}
          strokeWidth={width}
          opacity={opacity}
          fill="none"
          strokeLinecap={kind === "highlighter" ? HIGHLIGHTER_CAP : PEN_CAP}
          strokeLinejoin="round"
          style={{ pointerEvents: "none", mixBlendMode: blendFor(kind) }}
        />
      )}
    </svg>
  );
}

function SavedStroke({
  stroke,
  erasing,
}: {
  stroke: InkStroke;
  erasing: boolean;
}) {
  const isHighlighter = stroke.kind === "highlighter";
  // A highlighter is a uniform, flat-tipped, multiply-blended swipe — pressure
  // variation and round caps are a pen concern, so it renders as one flat path.
  const variable = !isHighlighter && hasPressureVariation(stroke.points);
  return (
    // Opacity applies at the GROUP level: a pressure stroke is many opaque
    // overlapping round-capped segments, and per-segment alpha would visibly
    // double up at every joint. Group opacity composites the whole stroke
    // once. Strokes saved before the field existed carry opacity 1.
    <g opacity={stroke.opacity ?? 1} style={{ mixBlendMode: isHighlighter ? "multiply" : undefined }}>
      {variable ? (
        inkSegments(stroke.points, stroke.width).map((seg, i) => (
          <path
            key={i}
            d={seg.d}
            stroke={stroke.color}
            strokeWidth={seg.w}
            fill="none"
            strokeLinecap="round"
            style={{ pointerEvents: "none" }}
          />
        ))
      ) : (
        <path
          d={inkPath(stroke.points)}
          stroke={stroke.color}
          strokeWidth={stroke.width}
          fill="none"
          strokeLinecap={isHighlighter ? "butt" : "round"}
          strokeLinejoin="round"
          style={{ pointerEvents: "none" }}
        />
      )}
      {/* Fat invisible hit target — only live while erasing, so it never blocks
          drawing over an existing stroke. The overlay finds it by data-ink-id
          via elementsFromPoint as the eraser sweeps across; it does not handle
          its own pointer events (touch would implicitly capture the first one
          and starve the rest of the sweep). */}
      <path
        data-ink-id={stroke.id}
        d={inkPath(stroke.points)}
        stroke="transparent"
        strokeWidth={Math.max(stroke.width * 3, 14)}
        fill="none"
        strokeLinecap="round"
        style={{ pointerEvents: erasing ? "stroke" : "none", cursor: "cell" }}
      />
    </g>
  );
}
