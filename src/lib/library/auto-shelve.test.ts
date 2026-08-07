import { describe, expect, it } from "vitest";
import { decideShelf, AUTO_SHELVE_CONFIDENCE } from "./auto-shelve";
import type { MetadataSuggestion } from "@/lib/metadata/openlibrary";

const BOOK = { id: "b1", title: "TCP/IP Illustrated", isbn: null, authors: ["Stevens"] };

function match(over: Partial<MetadataSuggestion>): MetadataSuggestion {
  return {
    source: "openlibrary",
    confidence: 0.9,
    authors: ["W. Richard Stevens"],
    subjects: ["TCP/IP (Computer network protocol)"],
    ...over,
  };
}

describe("decideShelf", () => {
  it("shelves a confident, classifiable match directly", async () => {
    const d = await decideShelf(BOOK, async () => [match({})]);
    expect(d).toEqual({
      action: "shelved",
      genre: "Networking & Sysadmin",
      subjects: ["TCP/IP (Computer network protocol)"],
    });
  });

  it("parks an uncertain match as a suggestion instead of guessing", async () => {
    const d = await decideShelf(BOOK, async () => [
      match({ confidence: AUTO_SHELVE_CONFIDENCE - 0.05 }),
    ]);
    expect(d.action).toBe("suggested");
  });

  it("parks a confident match whose subjects don't classify", async () => {
    const d = await decideShelf(BOOK, async () => [
      match({ subjects: ["zzz unclassifiable"] }),
    ]);
    expect(d.action).toBe("suggested");
  });

  it("skips when nothing plausible comes back", async () => {
    expect((await decideShelf(BOOK, async () => [])).action).toBe("skipped");
    expect(
      (await decideShelf(BOOK, async () => [match({ confidence: 0.05 })])).action,
    ).toBe("skipped");
  });
});

// ---------------------------------------------------------------------------
// Regression cover for the 2026-08-07 "matching got worse" report.
// ---------------------------------------------------------------------------

describe("decideShelf — a failed lookup is not a verdict", () => {
  it("reports 'failed', never 'skipped', when the lookup throws", async () => {
    const d = await decideShelf(BOOK, async () => {
      throw new Error("throttled");
    });
    // "skipped" is remembered by the sweep as a permanent no-match; a book the
    // service never answered for must stay in the queue instead.
    expect(d.action).toBe("failed");
  });

  it("still reports 'skipped' when the service genuinely knows nothing", async () => {
    expect((await decideShelf(BOOK, async () => [])).action).toBe("skipped");
  });
});

describe("decideShelf — shelves on the best candidate that carries a shelf", () => {
  it("uses a confident sibling's subjects when the top match has none", async () => {
    const d = await decideShelf(BOOK, async () => [
      match({ confidence: 0.95, subjects: [] }),
      match({ confidence: 0.7, subjects: ["Computer networks"] }),
    ]);
    // OpenLibrary's subject coverage is uneven across records of one work.
    // Reading only the top row parked obviously-classifiable books for review.
    expect(d).toEqual({
      action: "shelved",
      genre: "Networking & Sysadmin",
      subjects: ["Computer networks"],
    });
  });

  it("never reaches below the auto-shelve floor for subjects", async () => {
    const d = await decideShelf(BOOK, async () => [
      match({ confidence: 0.95, subjects: [] }),
      match({ confidence: AUTO_SHELVE_CONFIDENCE - 0.01, subjects: ["Computer networks"] }),
    ]);
    expect(d.action).toBe("suggested");
  });

  it("prefers the highest-confidence classifiable candidate", async () => {
    const d = await decideShelf(BOOK, async () => [
      match({ confidence: 0.95, subjects: [] }),
      match({ confidence: 0.9, subjects: ["Computer security"] }),
      match({ confidence: 0.6, subjects: ["Computer networks"] }),
    ]);
    expect(d).toMatchObject({ action: "shelved", genre: "Security & Privacy" });
  });
});
