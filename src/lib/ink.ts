// Shared ink-annotation model + geometry for the PDF reader's Draw tool.
// Single-sourced so the InkLayer overlay and the /api/ink routes agree on the
// palette, the accepted widths, and the coordinate space.

export type InkPoint = [number, number, number]; // [x, y, pressure] — all 0..1

// Two instruments share the freehand overlay. To a reader a pen and a
// highlighter are different tools: the pen lays an opaque, pressure-varying
// line; the highlighter lays a broad, flat-tipped, translucent swipe that
// multiply-blends so the text shows through it. `kind` is what the renderer
// switches on. Strokes saved before this field existed are pens.
export type InkKind = "pen" | "highlighter";

export interface InkStroke {
  id: string;
  page: number;
  color: string;
  width: number;
  /** 0..1 stroke opacity; 1 (solid) for strokes saved before the field existed. */
  opacity: number;
  /** "pen" (default) or "highlighter"; drives cap shape + blend at render. */
  kind: InkKind;
  points: InkPoint[];
}

export const INK_KINDS: InkKind[] = ["pen", "highlighter"];
export function isInkKind(v: unknown): v is InkKind {
  return v === "pen" || v === "highlighter";
}

// Pens are OPAQUE and saturated so they read on a white page (unlike the
// translucent highlighter palette). Names map 1:1 to accepted color values.
export const INK_COLORS: { name: string; value: string }[] = [
  { name: "Ink", value: "#1c1c1e" },
  { name: "Red", value: "#dc2626" },
  { name: "Blue", value: "#2563eb" },
  { name: "Green", value: "#15803d" },
  { name: "Amber", value: "#d97706" },
  { name: "Violet", value: "#7c3aed" },
];
const INK_COLOR_SET = new Set(INK_COLORS.map((c) => c.value));
export function isInkColor(v: unknown): v is string {
  return typeof v === "string" && INK_COLOR_SET.has(v);
}

// Widths are in overlay viewBox units (see INK_VB). They scale with the page.
export const INK_WIDTHS: { name: string; value: number; dot: number }[] = [
  { name: "Fine", value: 2.5, dot: 4 },
  { name: "Medium", value: 4, dot: 7 },
  { name: "Bold", value: 7, dot: 10 },
];
const INK_WIDTH_SET = new Set(INK_WIDTHS.map((w) => w.value));
export function isInkWidth(v: unknown): v is number {
  return typeof v === "number" && INK_WIDTH_SET.has(v);
}

// Opacity presets. Solid keeps the original opaque-pen look; the translucent
// steps make the pen usable as a marker over text without hiding it. Applied
// at the stroke GROUP level when rendering — per-segment opacity would show
// alpha build-up at every overlapping round cap of a pressure stroke.
export const INK_OPACITIES: { name: string; value: number }[] = [
  { name: "Solid", value: 1 },
  { name: "Soft", value: 0.6 },
  { name: "Marker", value: 0.35 },
];
const INK_OPACITY_SET = new Set(INK_OPACITIES.map((o) => o.value));
export function isInkOpacity(v: unknown): v is number {
  return typeof v === "number" && INK_OPACITY_SET.has(v);
}

// --- highlighter instrument -------------------------------------------------

// Highlighter colors. These are the SAME swatch values as the select-text
// highlight palette (src/lib/highlight-colors.ts) so freehand and text
// highlights read as one system. They render translucent via multiply blend,
// not via the pen's alpha, so the page shows through like a real marker.
export const HIGHLIGHTER_COLORS: { name: string; value: string }[] = [
  { name: "Yellow", value: "#fbbf24" },
  { name: "Green", value: "#34d399" },
  { name: "Blue", value: "#60a5fa" },
  { name: "Pink", value: "#f472b6" },
  { name: "Orange", value: "#fb923c" },
];
const HL_COLOR_SET = new Set(HIGHLIGHTER_COLORS.map((c) => c.value));
export function isHighlighterColor(v: unknown): v is string {
  return typeof v === "string" && HL_COLOR_SET.has(v);
}

// Highlighter widths are broad — a marker tip, not a pen nib (pen widths top
// out at 7). Same viewBox units as INK_WIDTHS.
export const HIGHLIGHTER_WIDTHS: { name: string; value: number; dot: number }[] = [
  { name: "Slim", value: 16, dot: 6 },
  { name: "Wide", value: 24, dot: 9 },
  { name: "Broad", value: 34, dot: 12 },
];
const HL_WIDTH_SET = new Set(HIGHLIGHTER_WIDTHS.map((w) => w.value));
export function isHighlighterWidth(v: unknown): v is number {
  return typeof v === "number" && HL_WIDTH_SET.has(v);
}

// The highlighter draws at one fixed translucency; multiply blend does the
// see-through work, so it has no opacity picker (unlike the pen).
export const HIGHLIGHTER_OPACITY = 0.4;

// Per-kind validation for the API: a highlighter can't be persisted with a pen
// color/width and vice-versa, so a bad client can't smuggle mismatched values.
export function isColorForKind(kind: InkKind, v: unknown): boolean {
  return kind === "highlighter" ? isHighlighterColor(v) : isInkColor(v);
}
export function isWidthForKind(kind: InkKind, v: unknown): boolean {
  return kind === "highlighter" ? isHighlighterWidth(v) : isInkWidth(v);
}

// A stroke can't reasonably hold more points than this; cap to bound request
// size and rendering cost.
export const MAX_INK_POINTS = 4000;

// The overlay SVG uses viewBox 0..INK_VB on both axes with
// preserveAspectRatio="none", so stored 0..1 fractions map straight onto it and
// a stroke scales with the page at any zoom — the same trick pdf-rect
// highlights use.
export const INK_VB = 1000;

function clamp01(n: number): number {
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

// Validate + normalize a points array from an untrusted request body.
export function parseInkPoints(raw: unknown): InkPoint[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const src = raw.length > MAX_INK_POINTS ? raw.slice(0, MAX_INK_POINTS) : raw;
  const out: InkPoint[] = [];
  for (const p of src) {
    if (!Array.isArray(p) || p.length < 2) return null;
    const x = Number(p[0]);
    const y = Number(p[1]);
    let pr = p.length > 2 ? Number(p[2]) : 0.5;
    if (!isFinite(x) || !isFinite(y)) return null;
    if (!isFinite(pr)) pr = 0.5;
    out.push([clamp01(x), clamp01(y), clamp01(pr)]);
  }
  return out;
}

// Smooth constant-width path (quadratic curves through midpoints), in viewBox
// units. Used both for the rendered stroke and as the erase hit-target shape.
export function inkPath(points: InkPoint[]): string {
  const s = INK_VB;
  const f = (n: number) => (n * s).toFixed(1);
  if (points.length === 1) {
    return `M ${f(points[0][0])} ${f(points[0][1])} l 0.1 0`;
  }
  let d = `M ${f(points[0][0])} ${f(points[0][1])}`;
  for (let i = 1; i < points.length - 1; i++) {
    const cx = f(points[i][0]);
    const cy = f(points[i][1]);
    const mx = f((points[i][0] + points[i + 1][0]) / 2);
    const my = f((points[i][1] + points[i + 1][1]) / 2);
    d += ` Q ${cx} ${cy} ${mx} ${my}`;
  }
  const last = points[points.length - 1];
  d += ` L ${f(last[0])} ${f(last[1])}`;
  return d;
}

// Variable-width pressure segments: opaque round-capped lines whose width
// follows the pen force at each point. Overlapping round caps (opaque, so no
// alpha build-up) read as one continuous variable stroke.
export function inkSegments(
  points: InkPoint[],
  baseWidth: number,
): { d: string; w: number }[] {
  const s = INK_VB;
  const f = (n: number) => (n * s).toFixed(1);
  const segs: { d: string; w: number }[] = [];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const force = 0.35 + (b[2] ?? 0.5) * 1.3;
    segs.push({
      d: `M ${f(a[0])} ${f(a[1])} L ${f(b[0])} ${f(b[1])}`,
      w: Number((baseWidth * force).toFixed(2)),
    });
  }
  return segs;
}

// True when a stroke carries real stylus pressure (worth rendering as
// variable-width segments rather than a single smooth path).
export function hasPressureVariation(points: InkPoint[]): boolean {
  return points.some((p) => p[2] > 0 && p[2] !== 0.5);
}
