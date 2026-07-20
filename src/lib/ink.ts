// Shared ink-annotation model + geometry for the PDF reader's Draw tool.
// Single-sourced so the InkLayer overlay and the /api/ink routes agree on the
// palette, the accepted widths, and the coordinate space.

// [x, y, pressure]. Pressure is always 0..1. Position is 0..1 for a
// page-anchored (PDF) stroke, whose fractions are of the whole page; a
// block-anchored (EPUB) stroke's fractions are of its anchor block and may run
// outside 0..1 where the mark extends past that block onto the rest of the page.
export type InkPoint = [number, number, number];

// Two instruments share the freehand overlay. To a reader a pen and a
// highlighter are different tools: the pen lays an opaque, pressure-varying
// line; the highlighter lays a broad, flat-tipped, translucent swipe that
// multiply-blends so the text shows through it. `kind` is what the renderer
// switches on. Strokes saved before this field existed are pens.
export type InkKind = "pen" | "highlighter";

export interface InkStroke {
  id: string;
  /**
   * The PDF page this stroke sits on. Null on an EPUB stroke, which has no page
   * to sit on and fastens to `anchor` instead — the wire carries `page: null`
   * for those rows.
   */
  page: number | null;
  /**
   * Present only on EPUB strokes; the wire omits the key entirely for PDF ones,
   * so a PDF payload stays byte-for-byte what it has always been.
   */
  anchor?: InkAnchor;
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

// --- what a stroke is fastened to -------------------------------------------

// A PDF page is a fixed canvas, so a stroke there anchors to a page number and
// its points are fractions of that page. A reflowable EPUB has no pages: font
// size, window width, and column count all move the text, so a stroke anchored
// to pixels would rot on the first reflow. Instead an EPUB stroke anchors to
// the CFI of the block element it was drawn on, with its points stored as
// fractions of THAT BLOCK's box — resolve the CFI, measure the block, repaint.
// The mark rides the text wherever the layout puts it.
//
// `section` is the spine index (epub.js `contents.sectionIndex`): a cheap
// integer pre-filter so rendering only attempts a CFI resolve against the
// section a stroke actually belongs to.
export type InkAnchor =
  | { kind: "page"; page: number }
  | { kind: "block"; cfi: string; section: number };

/**
 * Maximum length of a stored CFI, in UTF-16 units. Mirrors the
 * CHAPTER_HREF_MAX_LENGTH bound in src/lib/annotations/envelope.ts — same
 * posture, same order of magnitude, because it bounds the same kind of thing (a
 * document-location string). With every field bounded, a parsed anchor is
 * bounded by construction, so the serialized JSON needs no separate size gate.
 */
export const INK_CFI_MAX_LENGTH = 500;

function isObject(a: unknown): a is Record<string, unknown> {
  return typeof a === "object" && a !== null;
}

/**
 * Validate + normalize an anchor from an untrusted request body (or a stored
 * column), returning the anchor or null — the same shape as parseInkPoints.
 * Only the union's own keys survive, so nothing a client tacks on reaches the
 * database.
 */
export function parseInkAnchor(raw: unknown): InkAnchor | null {
  if (!isObject(raw)) return null;

  if (raw.kind === "page") {
    const { page } = raw;
    // Same bound the /api/ink page path has always enforced: pages are 1-based.
    if (typeof page !== "number" || !Number.isInteger(page) || page < 1) return null;
    return { kind: "page", page };
  }

  if (raw.kind === "block") {
    const { cfi, section } = raw;
    if (typeof cfi !== "string" || cfi.length === 0) return null;
    if (cfi.length > INK_CFI_MAX_LENGTH) return null;
    // Spine indexes are 0-based, so 0 is a real section — not a falsy reject.
    if (typeof section !== "number" || !Number.isInteger(section) || section < 0) {
      return null;
    }
    return { kind: "block", cfi, section };
  }

  return null;
}

/** The shape of a measured box. Plain object, so this file stays DOM-free. */
export interface InkRectLike {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Given the per-fragment rects of one block (`node.getClientRects()` returns one
 * rect per fragment when a block straddles a column break) and a stroke's saved
 * origin fraction, return the index of the fragment the stroke belongs to, or
 * null when there is nothing to paint into.
 *
 * The rects are normalized against their own union box, which puts them in the
 * same 0..1 space the stroke's points were saved in. An origin that lands in a
 * column gap — or off the block entirely after a reflow — resolves to the
 * NEAREST fragment rather than nowhere: a stroke that misses is worse than a
 * stroke a few millimetres off, so this never reports "no fragment" for a block
 * that has one.
 */
export function pickFragment(
  rects: InkRectLike[],
  originX: number,
  originY: number,
): number | null {
  if (rects.length === 0) return null;
  if (rects.length === 1) return 0;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const r of rects) {
    if (r.x < minX) minX = r.x;
    if (r.y < minY) minY = r.y;
    if (r.x + r.width > maxX) maxX = r.x + r.width;
    if (r.y + r.height > maxY) maxY = r.y + r.height;
  }
  const w = maxX - minX;
  const h = maxY - minY;
  // A collapsed union (a hidden or zero-area block) has no fraction space to
  // measure against; the first fragment is as good an answer as any.
  if (!(w > 0) || !(h > 0)) return 0;

  let nearest = 0;
  let nearestDist = Infinity;
  for (let i = 0; i < rects.length; i++) {
    const r = rects[i];
    const x0 = (r.x - minX) / w;
    const x1 = (r.x + r.width - minX) / w;
    const y0 = (r.y - minY) / h;
    const y1 = (r.y + r.height - minY) / h;
    if (originX >= x0 && originX <= x1 && originY >= y0 && originY <= y1) return i;
    // Distance from the origin to this fragment's box (0 on the inside).
    const dx = originX < x0 ? x0 - originX : originX > x1 ? originX - x1 : 0;
    const dy = originY < y0 ? y0 - originY : originY > y1 ? originY - y1 : 0;
    const dist = dx * dx + dy * dy;
    if (dist < nearestDist) {
      nearestDist = dist;
      nearest = i;
    }
  }
  return nearest;
}

/** The box every fragment of one block sits inside, or null for no fragments. */
export function unionRect(rects: InkRectLike[]): InkRectLike | null {
  if (rects.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const r of rects) {
    if (r.x < minX) minX = r.x;
    if (r.y < minY) minY = r.y;
    if (r.x + r.width > maxX) maxX = r.x + r.width;
    if (r.y + r.height > maxY) maxY = r.y + r.height;
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/** Where one stroke lands on the overlay. All values are overlay-local px. */
export interface InkPlacement {
  /** The box the stroke's 0..1 fractions map onto — the anchoring block's box. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** True when the block straddles a column break, i.e. `clip*` is worth using. */
  torn: boolean;
  /** The fragment that owns the stroke; a torn block's paint is clipped to it. */
  clipX: number;
  clipY: number;
  clipWidth: number;
  clipHeight: number;
  /** px per viewBox unit for the NIB — one scalar, never the box's aspect. */
  strokeScale: number;
}

/**
 * Place one stroke: given the on-screen fragments of the block it is fastened to
 * (viewport coords) and the overlay's own origin, return the overlay-local
 * geometry to paint it with, or null when there is no box to paint into.
 *
 * The fractions map onto the fragments' UNION box, which is the same space
 * capture measured them in — so at an unchanged layout this is the exact inverse
 * of capture and a stroke stays precisely where it was drawn, split block or
 * not. `pickFragment` then names the fragment the stroke's origin lives in, and
 * a torn block clips its paint to that fragment: after a reflow tears a block
 * the union spans the column gap, and without the clip a stroke would smear
 * across the gap into the wrong column (decision D2 — degrade un-stretched,
 * never smear). An untorn block is not clipped at all, so a nib riding the
 * block's edge keeps its full width.
 *
 * `strokeScale` comes from the FRAGMENT, not the union: a torn block's union
 * spans two columns, and scaling the nib by it would draw every stroke on a
 * split paragraph at double thickness.
 */
export function placeInkStroke(
  rects: InkRectLike[],
  originX: number,
  originY: number,
  surfaceLeft: number,
  surfaceTop: number,
): InkPlacement | null {
  const idx = pickFragment(rects, originX, originY);
  const union = unionRect(rects);
  if (idx === null || !union) return null;
  // A block that is hidden or not yet laid out measures zero: there is no space
  // to map fractions onto, and scaling by it would collapse the stroke to a dot.
  if (!(union.width > 0) || !(union.height > 0)) return null;

  const frag = rects[idx];
  return {
    x: union.x - surfaceLeft,
    y: union.y - surfaceTop,
    width: union.width,
    height: union.height,
    torn: rects.length > 1,
    clipX: frag.x - surfaceLeft,
    clipY: frag.y - surfaceTop,
    clipWidth: frag.width,
    clipHeight: frag.height,
    strokeScale: (frag.width > 0 ? frag.width : union.width) / INK_VB,
  };
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
//
// `allowOverflow` frees the POSITION axes from the 0..1 clamp for block-anchored
// (EPUB) strokes: those fractions are of the one text block a mark started on,
// and a freehand stroke routinely runs past that small block onto the rest of
// the page. Clamping there pins every outside point to the block edge, which is
// exactly the "straight line along an invisible boundary" bug. A page-anchored
// (PDF) stroke's fractions are of the whole page — the actual canvas — so it
// keeps the clamp and nothing lands off-page. Pressure is a true 0..1 quantity
// either way and is always clamped. Non-finite still rejects: the bound that
// matters for storage is the point COUNT (MAX_INK_POINTS), not the magnitude.
export function parseInkPoints(
  raw: unknown,
  opts?: { allowOverflow?: boolean },
): InkPoint[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const clampPos = opts?.allowOverflow ? (n: number) => n : clamp01;
  const src = raw.length > MAX_INK_POINTS ? raw.slice(0, MAX_INK_POINTS) : raw;
  const out: InkPoint[] = [];
  for (const p of src) {
    if (!Array.isArray(p) || p.length < 2) return null;
    const x = Number(p[0]);
    const y = Number(p[1]);
    let pr = p.length > 2 ? Number(p[2]) : 0.5;
    if (!isFinite(x) || !isFinite(y)) return null;
    if (!isFinite(pr)) pr = 0.5;
    out.push([clampPos(x), clampPos(y), clamp01(pr)]);
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
