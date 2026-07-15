// ANCHOR-SORT-01 — position-in-book ordering for PARSED anchors, the panel's
// twin of markdown-export's locator sort. Pure (@/lib/annotations).
//
// Branches exercised: CFI document order (numeric, not lexical) · PDF page
// numeric order · progression bucket for unresolved text-quote anchors ·
// locator-less anchors sink to the end · id tiebreak makes the order
// deterministic · input array untouched.

import { describe, it, expect } from "vitest";
import { anchorSortKey, byBookPosition } from "@/lib/annotations";

describe("anchorSortKey", () => {
  it("sorts CFIs in document order, not lexically", () => {
    const early = anchorSortKey({ cfi: "epubcfi(/6/2!/4/2)" });
    const late = anchorSortKey({ cfi: "epubcfi(/6/14!/4/2)" });
    expect(early < late).toBe(true);
  });

  it("sorts pages numerically", () => {
    expect(anchorSortKey({ page: 2 }) < anchorSortKey({ page: 12 })).toBe(true);
  });

  it("buckets: unresolved progression sorts after locators, no-locator sinks last", () => {
    const cfi = anchorSortKey({ cfi: "/6/2" });
    const prog = anchorSortKey({ progression: 0.5 });
    const none = anchorSortKey({});
    expect(cfi < prog).toBe(true);
    expect(prog < none).toBe(true);
  });
});

describe("byBookPosition", () => {
  it("orders by position with id as the deterministic tiebreak, without mutating input", () => {
    const input = [
      { id: "b", anchor: { page: 12 } },
      { id: "z", anchor: { page: 2 } },
      { id: "a", anchor: { page: 12 } },
    ];
    const snapshot = [...input];
    const sorted = byBookPosition(input);
    expect(sorted.map((h) => h.id)).toEqual(["z", "a", "b"]);
    expect(input).toEqual(snapshot);
  });
});
