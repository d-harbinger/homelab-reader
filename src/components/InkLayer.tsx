"use client";

import { useRef, useState, useCallback } from "react";
import {
  INK_VB,
  inkPath,
  inkSegments,
  hasPressureVariation,
  type InkStroke,
  type InkPoint,
} from "@/lib/ink";

interface Props {
  strokes: InkStroke[]; // saved strokes for THIS page
  drawMode: boolean;
  erasing: boolean;
  color: string;
  width: number;
  opacity: number;
  onCommit: (points: InkPoint[]) => void; // a finished stroke — parent persists
  onErase: (id: string) => void;
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
  onCommit,
  onErase,
}: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const rectRef = useRef<DOMRect | null>(null);
  const drawing = useRef(false);
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

  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!drawMode || erasing) return;
    e.preventDefault();
    rectRef.current = svgRef.current?.getBoundingClientRect() ?? null;
    svgRef.current?.setPointerCapture(e.pointerId);
    drawing.current = true;
    setCurrent([toPoint(e.clientX, e.clientY, e.pressure, e.pointerType)]);
  };

  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!drawing.current) return;
    e.preventDefault();
    const native = e.nativeEvent as PointerEvent;
    const coalesced =
      typeof native.getCoalescedEvents === "function" ? native.getCoalescedEvents() : [];
    const src = coalesced.length ? coalesced : [native];
    setCurrent((cur) => {
      if (!cur) return cur;
      const next = cur.slice();
      for (const ev of src) {
        const pt = toPoint(ev.clientX, ev.clientY, ev.pressure, ev.pointerType);
        const last = next[next.length - 1];
        const dx = (pt[0] - last[0]) * INK_VB;
        const dy = (pt[1] - last[1]) * INK_VB;
        if (dx * dx + dy * dy < 4) continue; // drop sub-2-unit jitter
        next.push(pt);
      }
      return next;
    });
  };

  const endStroke = () => {
    if (!drawing.current) return;
    drawing.current = false;
    setCurrent((cur) => {
      if (cur && cur.length) onCommit(cur);
      return null;
    });
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
        <SavedStroke key={s.id} stroke={s} erasing={erasing} onErase={onErase} />
      ))}
      {current && (
        <path
          d={inkPath(current)}
          stroke={color}
          strokeWidth={width}
          opacity={opacity}
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ pointerEvents: "none" }}
        />
      )}
    </svg>
  );
}

function SavedStroke({
  stroke,
  erasing,
  onErase,
}: {
  stroke: InkStroke;
  erasing: boolean;
  onErase: (id: string) => void;
}) {
  const variable = hasPressureVariation(stroke.points);
  return (
    // Opacity applies at the GROUP level: a pressure stroke is many opaque
    // overlapping round-capped segments, and per-segment alpha would visibly
    // double up at every joint. Group opacity composites the whole stroke
    // once. Strokes saved before the field existed carry opacity 1.
    <g opacity={stroke.opacity ?? 1}>
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
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ pointerEvents: "none" }}
        />
      )}
      {/* Fat invisible hit target — only live while erasing, so it never blocks
          drawing over an existing stroke. */}
      <path
        d={inkPath(stroke.points)}
        stroke="transparent"
        strokeWidth={Math.max(stroke.width * 3, 14)}
        fill="none"
        strokeLinecap="round"
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
  );
}
