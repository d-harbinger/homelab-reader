// RESOLVE-TEXTQUOTE-01 — unit tests for the pure orchestration helpers that
// drive the web reader's one-time resolution of synced text-quote highlights
// into EPUB CFIs (Phase C, slice P2). The DOM/epub.js glue (toRange,
// cfiFromRange, the annotation mark, the upgrade PATCH) stays in EpubReader.tsx;
// only the decision logic lives here, so it is unit-testable in the node env.
//
// Every branch of every helper is enumerated below (mirrors the branch list in
// src/lib/annotations/resolve-textquote.ts's header comment):
//
//   hrefsMatch
//     H1 exact equality after normalization           -> true
//     H2 one path is a suffix of the other            -> true
//     H3 fragment/query stripped before comparing     -> true
//     H4 unrelated hrefs                              -> false
//     H5 empty / missing input                        -> false
//
//   sectionMatchesAnchor  (href is authoritative when present)
//     S1 chapterHref present + matches section        -> true
//     S2 chapterHref present + does NOT match         -> false (skip; do not
//        burn the once-per-session attempt in the wrong section)
//     S3 no href, progression in section window       -> true
//     S4 no href, progression outside the window      -> false
//     S5 no href, progression but section has no bounds-> true (attempt on view)
//     S6 no href, no progression                      -> true (attempt on view)
//
//   buildUpgradePayload
//     U1 valid cfi   -> { anchor: { type: "epub-cfi-range", cfi } }
//     U2 empty/blank -> null (never PATCH a garbage anchor)
//
//   jumpTarget
//     J1 cfi present            -> { kind: "cfi" }   (cfi wins over progression)
//     J2 no cfi, finite progression -> { kind: "percent" }
//     J3 no cfi, no/NaN progression -> { kind: "none" } (no-op; entry stays listed)
//
//   createResolutionTracker
//     T1 first attempt for an id -> true (and marks it)
//     T2 repeat id               -> false
//     T3 distinct ids are independent
//     T4 empty id                -> false (never tracked)

import { describe, it, expect } from "vitest";
import {
  hrefsMatch,
  sectionMatchesAnchor,
  buildUpgradePayload,
  jumpTarget,
  createResolutionTracker,
  SECTION_PROGRESSION_MARGIN,
} from "@/lib/annotations/resolve-textquote";

describe("hrefsMatch", () => {
  it("H1 matches identical hrefs", () => {
    expect(hrefsMatch("OEBPS/ch1.xhtml", "OEBPS/ch1.xhtml")).toBe(true);
  });

  it("H2 matches when one path is a suffix of the other", () => {
    expect(hrefsMatch("ch1.xhtml", "OEBPS/ch1.xhtml")).toBe(true);
    expect(hrefsMatch("OEBPS/ch1.xhtml", "ch1.xhtml")).toBe(true);
  });

  it("H3 ignores a fragment or query string", () => {
    expect(hrefsMatch("ch1.xhtml#p3", "OEBPS/ch1.xhtml")).toBe(true);
    expect(hrefsMatch("ch1.xhtml?v=2", "ch1.xhtml")).toBe(true);
  });

  it("H4 rejects unrelated hrefs", () => {
    expect(hrefsMatch("ch1.xhtml", "ch2.xhtml")).toBe(false);
    // A shared basename in different directories is NOT a suffix match.
    expect(hrefsMatch("a/index.xhtml", "b/index.xhtml")).toBe(false);
  });

  it("H5 rejects empty or missing input", () => {
    expect(hrefsMatch("", "ch1.xhtml")).toBe(false);
    expect(hrefsMatch("ch1.xhtml", "")).toBe(false);
    expect(hrefsMatch(undefined, "ch1.xhtml")).toBe(false);
  });
});

describe("sectionMatchesAnchor", () => {
  it("S1 attempts when chapterHref matches the section", () => {
    expect(
      sectionMatchesAnchor(
        { chapterHref: "ch1.xhtml", progression: 0.9 },
        { href: "OEBPS/ch1.xhtml" },
      ),
    ).toBe(true);
  });

  it("S2 skips when chapterHref is present but does not match", () => {
    // href is authoritative: even a progression that would land in this
    // section's window must not trigger an attempt in the wrong chapter.
    expect(
      sectionMatchesAnchor(
        { chapterHref: "ch2.xhtml", progression: 0.1 },
        { href: "ch1.xhtml", startProgression: 0, endProgression: 0.2 },
      ),
    ).toBe(false);
  });

  it("S3 attempts when progression falls within the section window (no href)", () => {
    expect(
      sectionMatchesAnchor(
        { progression: 0.15 },
        { href: "ch1.xhtml", startProgression: 0.1, endProgression: 0.2 },
      ),
    ).toBe(true);
  });

  it("S3 tolerates the margin around the window edges", () => {
    const justOver = 0.2 + SECTION_PROGRESSION_MARGIN / 2;
    expect(
      sectionMatchesAnchor(
        { progression: justOver },
        { href: "ch1.xhtml", startProgression: 0.1, endProgression: 0.2 },
      ),
    ).toBe(true);
  });

  it("S4 skips when progression is outside the window (no href)", () => {
    expect(
      sectionMatchesAnchor(
        { progression: 0.9 },
        { href: "ch1.xhtml", startProgression: 0.1, endProgression: 0.2 },
      ),
    ).toBe(false);
  });

  it("S5 attempts when progression is present but the section has no bounds", () => {
    expect(
      sectionMatchesAnchor({ progression: 0.5 }, { href: "ch1.xhtml" }),
    ).toBe(true);
  });

  it("S6 attempts when the anchor carries no positioning signal at all", () => {
    expect(sectionMatchesAnchor({}, { href: "ch1.xhtml" })).toBe(true);
  });
});

describe("buildUpgradePayload", () => {
  it("U1 wraps a valid cfi in the upgrade anchor shape", () => {
    expect(buildUpgradePayload("epubcfi(/6/4!/4/2,/1:0,/1:9)")).toEqual({
      anchor: { type: "epub-cfi-range", cfi: "epubcfi(/6/4!/4/2,/1:0,/1:9)" },
    });
  });

  it("U2 returns null for an empty or blank cfi", () => {
    expect(buildUpgradePayload("")).toBeNull();
    expect(buildUpgradePayload("   ")).toBeNull();
  });
});

describe("jumpTarget", () => {
  it("J1 prefers the cfi when present", () => {
    expect(jumpTarget({ cfi: "epubcfi(/6/4!/4/2)", progression: 0.5 })).toEqual({
      kind: "cfi",
      cfi: "epubcfi(/6/4!/4/2)",
    });
  });

  it("J2 degrades to percent when there is no cfi", () => {
    expect(jumpTarget({ progression: 0.42 })).toEqual({
      kind: "percent",
      progression: 0.42,
    });
  });

  it("J3 is a no-op when neither a cfi nor a usable progression is present", () => {
    expect(jumpTarget({})).toEqual({ kind: "none" });
    expect(jumpTarget({ progression: Number.NaN })).toEqual({ kind: "none" });
    expect(jumpTarget({ cfi: "" })).toEqual({ kind: "none" });
  });
});

describe("createResolutionTracker", () => {
  it("T1/T2 attempts an id once, then refuses on repeat", () => {
    const tracker = createResolutionTracker();
    expect(tracker.shouldAttempt("h1")).toBe(true);
    expect(tracker.shouldAttempt("h1")).toBe(false);
    expect(tracker.shouldAttempt("h1")).toBe(false);
  });

  it("T3 tracks distinct ids independently", () => {
    const tracker = createResolutionTracker();
    expect(tracker.shouldAttempt("h1")).toBe(true);
    expect(tracker.shouldAttempt("h2")).toBe(true);
    expect(tracker.shouldAttempt("h1")).toBe(false);
    expect(tracker.shouldAttempt("h2")).toBe(false);
  });

  it("T4 never tracks an empty id", () => {
    const tracker = createResolutionTracker();
    expect(tracker.shouldAttempt("")).toBe(false);
    expect(tracker.shouldAttempt("")).toBe(false);
  });
});
