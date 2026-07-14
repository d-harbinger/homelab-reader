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
