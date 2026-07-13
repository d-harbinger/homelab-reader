// Pure orchestration helpers for the web reader's one-time resolution of synced
// text-quote highlights into EPUB CFIs (Phase C, slice P2).
//
// A highlight created on another device (the android reader) arrives with a
// text-quote anchor — the surrounding text plus a 0..1 reading position — but no
// CFI, because a CFI only means anything inside a specific EPUB rendition. The
// web reader resolves it lazily: when a section renders, it fuzzy-matches the
// quote in that section's DOM (dom-anchor-text-quote), turns the found range into
// a CFI, paints the mark, and PATCHes the anchor upgrade so the work happens
// once. Highlights that never resolve still appear in the panel and jump by
// reading percentage instead.
//
// The DOM/epub.js glue (toRange, contents.cfiFromRange, the annotation mark, the
// fetch) stays in EpubReader.tsx. Only the decision logic lives here, pure, so it
// unit-tests in the node environment (tests/resolve-textquote.test.ts).
//
// Branches (each covered in the test file):
//   hrefsMatch
//     H1 exact equality after normalization           -> true
//     H2 one path is a suffix of the other            -> true
//     H3 fragment/query stripped before comparing     -> true
//     H4 unrelated hrefs                              -> false
//     H5 empty / missing input                        -> false
//   sectionMatchesAnchor  (chapterHref is authoritative when present)
//     S1 chapterHref present + matches                -> true
//     S2 chapterHref present + no match               -> false
//     S3 no href, progression inside the window       -> true
//     S4 no href, progression outside the window      -> false
//     S5 no href, progression but section has no bounds-> true
//     S6 no href, no progression                      -> true
//   buildUpgradePayload
//     U1 valid cfi   -> upgrade payload
//     U2 empty/blank -> null
//   jumpTarget
//     J1 cfi present            -> { kind: "cfi" }
//     J2 finite progression     -> { kind: "percent" }
//     J3 neither                -> { kind: "none" }
//   createResolutionTracker
//     T1 first attempt -> true (marks)   T2 repeat -> false
//     T3 distinct ids independent        T4 empty id -> false

/**
 * How far outside a section's [start,end] reading-position window a highlight's
 * progression may fall and still be considered "near" the section. epub.js
 * per-section boundaries are approximate, so a small margin avoids missing a
 * highlight that sits right at a chapter seam.
 */
export const SECTION_PROGRESSION_MARGIN = 0.02;

/** The subset of a stored text-quote anchor the section matcher reads. */
export interface TextQuoteAnchorLike {
  chapterHref?: string;
  progression?: number;
}

/** A rendered spine section, plus its reading-position window when known. */
export interface RenderedSection {
  href: string;
  /** 0..1 reading position at the section start, when the locations index is ready. */
  startProgression?: number;
  /** 0..1 reading position at the section end, when the locations index is ready. */
  endProgression?: number;
}

/** Strip a fragment/query and a leading "./", leaving a bare path for comparison. */
function normalizeHref(href: string): string {
  let h = href.split("#")[0].split("?")[0];
  if (h.startsWith("./")) h = h.slice(2);
  return h;
}

/**
 * True when two spine-item hrefs name the same document. EPUB readers report
 * hrefs with differing path prefixes (a bare "ch1.xhtml" versus the packaged
 * "OEBPS/ch1.xhtml"), so an exact string compare is too strict: one href
 * counting as a path-suffix of the other (on a "/" boundary) also matches. A
 * shared basename in different directories does NOT match.
 */
export function hrefsMatch(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b) return false;
  const na = normalizeHref(a);
  const nb = normalizeHref(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  return na.endsWith(`/${nb}`) || nb.endsWith(`/${na}`);
}

/**
 * Decide whether to attempt resolving a text-quote anchor in a just-rendered
 * section. chapterHref is authoritative when present: a highlight whose chapter
 * does not match the section is skipped outright, so the one-per-session attempt
 * is spent in the right chapter rather than burned on a wrong-section miss. With
 * no chapterHref, a progression that lands in (or within the margin of) the
 * section's reading-position window qualifies. With neither usable signal, the
 * on-view section is attempted — the fuzzy match simply fails cheaply if the
 * quote is not there.
 */
export function sectionMatchesAnchor(
  anchor: TextQuoteAnchorLike,
  section: RenderedSection,
): boolean {
  const hasHref = typeof anchor.chapterHref === "string" && anchor.chapterHref.length > 0;
  if (hasHref) {
    return hrefsMatch(anchor.chapterHref, section.href);
  }

  const hasProgression =
    typeof anchor.progression === "number" && Number.isFinite(anchor.progression);
  const hasBounds =
    typeof section.startProgression === "number" &&
    Number.isFinite(section.startProgression) &&
    typeof section.endProgression === "number" &&
    Number.isFinite(section.endProgression);

  if (hasProgression && hasBounds) {
    const p = anchor.progression as number;
    const lo = (section.startProgression as number) - SECTION_PROGRESSION_MARGIN;
    const hi = (section.endProgression as number) + SECTION_PROGRESSION_MARGIN;
    return p >= lo && p <= hi;
  }

  // No positioning signal we can act on — attempt on the currently-viewed
  // section (resolve-on-view; never a whole-spine loop at open).
  return true;
}

/** The PATCH body for the P1 one-time anchor upgrade. */
export interface UpgradePayload {
  anchor: { type: "epub-cfi-range"; cfi: string };
}

/**
 * Build the anchor-upgrade PATCH body once a text-quote highlight resolves to a
 * CFI. Returns null for a missing/blank CFI so the caller never PATCHes a
 * garbage anchor (the server would 400 it anyway).
 */
export function buildUpgradePayload(cfi: string): UpgradePayload | null {
  if (typeof cfi !== "string" || cfi.trim().length === 0) return null;
  return { anchor: { type: "epub-cfi-range", cfi } };
}

/** Where the panel's jump action should send the reader for a highlight. */
export type JumpTarget =
  | { kind: "cfi"; cfi: string }
  | { kind: "percent"; progression: number }
  | { kind: "none" };

/**
 * Decide how to jump to a highlight from the panel. A resolved CFI is exact and
 * wins. Otherwise an unresolved text-quote highlight degrades to its reading
 * percentage (the caller maps it through book.locations.cfiFromPercentage). With
 * neither, the jump is a no-op and the entry simply stays listed in the panel.
 */
export function jumpTarget(anchor: {
  cfi?: string;
  progression?: number;
}): JumpTarget {
  if (typeof anchor.cfi === "string" && anchor.cfi.length > 0) {
    return { kind: "cfi", cfi: anchor.cfi };
  }
  if (typeof anchor.progression === "number" && Number.isFinite(anchor.progression)) {
    return { kind: "percent", progression: anchor.progression };
  }
  return { kind: "none" };
}

/** Once-per-session resolution bookkeeping (see shouldAttempt). */
export interface ResolutionTracker {
  /**
   * True the first time an id is seen (and marks it), false every time after.
   * A blank id is never tracked and always returns false. Callers gate on the
   * section match FIRST, then call this, so the single attempt is spent in the
   * matching section rather than the first section that happens to render.
   */
  shouldAttempt(id: string): boolean;
}

/** Create a per-reader-session tracker that attempts each highlight at most once. */
export function createResolutionTracker(): ResolutionTracker {
  const attempted = new Set<string>();
  return {
    shouldAttempt(id: string): boolean {
      if (!id) return false;
      if (attempted.has(id)) return false;
      attempted.add(id);
      return true;
    },
  };
}
