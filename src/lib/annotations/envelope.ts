// The text-quote annotation envelope (Phase C, slice P1) — the wire shape a
// highlight created on another device (the android reader) carries across the
// sync channel BEFORE the web reader resolves it to an EPUB CFI.
//
//   { type: "text-quote",
//     quote:       "<exact selected text>",   // required
//     prefix?:     "<text just before>",       // optional disambiguator
//     suffix?:     "<text just after>",        // optional disambiguator
//     chapterHref?:"<spine item href>",        // optional search-narrowing hint
//     progression?: 0.0-1.0 }                   // optional degrade-to-percent target
//
// Server-side this lives INSIDE the existing Highlight.anchor JSON blob — no
// Prisma column change. Validation lives here ONCE so both auth front doors
// (cookie-session /api/highlights* and OPDS-token /api/opds/highlights*) apply
// the same bounds through the shared highlights lib. This module is pure: no
// Prisma, no next/server, no auth seam — unit-testable in the node environment.

/** Maximum length of the required quote, in UTF-16 units. */
export const QUOTE_MAX_LENGTH = 2000;
/** Maximum length of each optional prefix/suffix context window. */
export const CONTEXT_MAX_LENGTH = 200;
/** Maximum length of the optional chapter-href hint. */
export const CHAPTER_HREF_MAX_LENGTH = 500;

export interface AnnotationEnvelope {
  type: "text-quote";
  /** The exact selected text — required, drives re-anchoring on another device. */
  quote: string;
  /** Text immediately before the selection, disambiguates repeated quotes. */
  prefix?: string;
  /** Text immediately after the selection, disambiguates repeated quotes. */
  suffix?: string;
  /** Spine-item href, narrows the search space when resolving. */
  chapterHref?: string;
  /** Reading position in 0..1, disambiguates and is the degrade-to-percent target. */
  progression?: number;
}

export type ParseEnvelopeResult =
  | { ok: true; envelope: AnnotationEnvelope }
  | { ok: false; error: string };

function isObject(a: unknown): a is Record<string, unknown> {
  return typeof a === "object" && a !== null;
}

/**
 * True when `a` is an object whose discriminator marks it as a text-quote
 * anchor. A cheap shape check only — call parseTextQuoteAnchor to validate the
 * fields and obtain a normalized envelope.
 */
export function isTextQuoteAnchor(a: unknown): boolean {
  return isObject(a) && a.type === "text-quote";
}

/**
 * Validate a candidate text-quote anchor against the envelope bounds and return
 * a normalized envelope (clamped progression, only the present optional keys) or
 * a caller-surfaceable error string. Optional keys that are absent stay absent —
 * the stored JSON never gains empty-string noise.
 */
export function parseTextQuoteAnchor(a: unknown): ParseEnvelopeResult {
  if (!isObject(a) || a.type !== "text-quote") {
    return { ok: false, error: "anchor is not a text-quote anchor" };
  }

  const { quote, prefix, suffix, chapterHref, progression } = a;

  if (typeof quote !== "string" || quote.length === 0) {
    return { ok: false, error: "text-quote anchor requires a non-empty quote" };
  }
  if (quote.length > QUOTE_MAX_LENGTH) {
    return { ok: false, error: "quote exceeds the maximum length" };
  }

  const envelope: AnnotationEnvelope = { type: "text-quote", quote };

  if (prefix !== undefined) {
    if (typeof prefix !== "string" || prefix.length > CONTEXT_MAX_LENGTH) {
      return { ok: false, error: "prefix is not a string within the length bound" };
    }
    envelope.prefix = prefix;
  }

  if (suffix !== undefined) {
    if (typeof suffix !== "string" || suffix.length > CONTEXT_MAX_LENGTH) {
      return { ok: false, error: "suffix is not a string within the length bound" };
    }
    envelope.suffix = suffix;
  }

  if (chapterHref !== undefined) {
    if (typeof chapterHref !== "string" || chapterHref.length > CHAPTER_HREF_MAX_LENGTH) {
      return { ok: false, error: "chapterHref is not a string within the length bound" };
    }
    envelope.chapterHref = chapterHref;
  }

  if (progression !== undefined) {
    // A present progression must be a real, finite number; a numeric value out
    // of [0,1] is clamped (the reading position degrades gracefully), but a
    // non-numeric or non-finite value is a malformed anchor.
    if (typeof progression !== "number" || !Number.isFinite(progression)) {
      return { ok: false, error: "progression must be a finite number" };
    }
    envelope.progression = Math.min(1, Math.max(0, progression));
  }

  return { ok: true, envelope };
}

/**
 * Maximum serialized length of a stored anchor JSON blob, in UTF-16 units.
 * The text-quote envelope above is field-bounded; this is the backstop for
 * EVERY OTHER anchor shape (epub-cfi-range, pdf-rect, …), so a device sync
 * client can't write an unbounded blob into SQLite. Generous next to a real
 * anchor (a CFI or a page-rect list sits well under this), tight next to a
 * denial-of-service payload.
 */
export const ANCHOR_JSON_MAX_LENGTH = 8192;

export type SerializeAnchorResult =
  | { ok: true; json: string }
  | { ok: false; error: string };

/**
 * Serialize an anchor to the JSON persisted in the DB, rejecting anything over
 * ANCHOR_JSON_MAX_LENGTH. Every anchor write site uses this instead of a raw
 * JSON.stringify so no shape — validated envelope or otherwise — is stored
 * without a size bound. Pure: no Prisma, no next/server.
 */
export function serializeAnchorBounded(anchor: unknown): SerializeAnchorResult {
  // JSON.stringify has two failure modes on an `unknown`, and this function is
  // handed `unknown` precisely because the anchor arrives in a request body
  // written by another device. It RETURNS UNDEFINED for a value with no JSON
  // representation (undefined itself, a function, a symbol), and it THROWS for
  // a circular structure, a BigInt, or an object whose toJSON throws. Left
  // unhandled the first made `json.length` a TypeError and the second escaped
  // this function, and either one surfaces on the sync route as a 500 — one
  // unstorable anchor from one device failing a whole request instead of being
  // refused on its own. An anchor with no JSON form is not storable, which is
  // the same answer as an anchor that is too large: refuse this one, and let
  // the caller keep the rest of the batch.
  let json: string | undefined;
  try {
    json = JSON.stringify(anchor);
  } catch {
    return { ok: false, error: "anchor could not be serialized" };
  }
  if (typeof json !== "string") {
    return { ok: false, error: "anchor could not be serialized" };
  }
  if (json.length > ANCHOR_JSON_MAX_LENGTH) {
    return { ok: false, error: "anchor exceeds the maximum size" };
  }
  return { ok: true, json };
}
