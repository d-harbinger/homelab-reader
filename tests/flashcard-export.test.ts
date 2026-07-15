// FLASHCARD-EXPORT-01 — pure renderer: highlights (+ paired notes + the color
// key) → Anki plain-text import format. No DB, no fs — mirrors
// notes-markdown-export.test.ts.
//
// Branches exercised:
//   - header directives always present (separator/html/tags column)
//   - back precedence: note body > color-key meaning > empty
//   - tags: book slug always; key meaning slugified when the color is labeled
//   - ordering: locator (page/CFI document order) beats input order
//   - escaping: tab/newline/quote fields are quoted CSV-style
//   - note pairing: structural highlightId wins; CFI fallback still pairs
//   - zero highlights → header-only file

import { describe, it, expect } from "vitest";
import {
  exportFlashcards,
  slugifyTag,
  type FlashcardHighlight,
  type FlashcardNote,
} from "@/lib/notes/flashcard-export";

const t0 = new Date("2026-07-01T10:00:00Z");

function hl(over: Partial<FlashcardHighlight>): FlashcardHighlight {
  return {
    id: "h1",
    text: "Highlighted passage",
    color: "yellow",
    anchor: JSON.stringify({ type: "pdf-rect", page: 3, rects: [] }),
    createdAt: t0,
    ...over,
  };
}

function note(over: Partial<FlashcardNote>): FlashcardNote {
  return {
    id: "n1",
    body: "A note",
    anchor: JSON.stringify({ type: "pdf-point", page: 3 }),
    highlightId: null,
    ...over,
  };
}

function render(
  highlights: FlashcardHighlight[],
  notes: FlashcardNote[] = [],
  colorKey: Record<string, string> = {},
): string[] {
  return exportFlashcards({
    book: { title: "Think Python" },
    highlights,
    notes,
    colorKey,
  }).split("\n");
}

describe("exportFlashcards", () => {
  it("emits the Anki header directives, then one line per highlight", () => {
    const lines = render([hl({})]);
    expect(lines[0]).toBe("#separator:tab");
    expect(lines[1]).toBe("#html:false");
    expect(lines[2]).toBe("#tags column:3");
    expect(lines[3]).toBe("Highlighted passage\t\tthink-python");
    // exactly one trailing newline
    expect(lines[4]).toBe("");
    expect(lines).toHaveLength(5);
  });

  it("zero highlights → header-only file", () => {
    const lines = render([]);
    expect(lines).toEqual([
      "#separator:tab",
      "#html:false",
      "#tags column:3",
      "",
    ]);
  });

  it("back precedence: an attached note beats the color-key meaning", () => {
    const lines = render(
      [hl({ id: "h9", color: "yellow" })],
      [note({ highlightId: "h9", body: "Definition from my note" })],
      { yellow: "Key terms" },
    );
    expect(lines[3]).toBe(
      "Highlighted passage\tDefinition from my note\tthink-python key-terms",
    );
  });

  it("an unnoted highlight falls back to the color's meaning as the back", () => {
    const lines = render([hl({ color: "blue" })], [], {
      blue: "Organizations",
    });
    expect(lines[3]).toBe(
      "Highlighted passage\tOrganizations\tthink-python organizations",
    );
  });

  it("pairs a pre-FK note by CFI when no highlightId exists", () => {
    const anchor = JSON.stringify({ type: "epub-cfi-range", cfi: "/6/4!/2" });
    const lines = render(
      [hl({ anchor })],
      [note({ anchor: JSON.stringify({ type: "epub-cfi", cfi: "/6/4!/2" }), body: "CFI-paired" })],
    );
    expect(lines[3]).toContain("\tCFI-paired\t");
  });

  it("orders cards by position in the book, not input order", () => {
    const lines = render([
      hl({ id: "late", text: "Page twelve", anchor: JSON.stringify({ page: 12 }) }),
      hl({ id: "early", text: "Page two", anchor: JSON.stringify({ page: 2 }) }),
    ]);
    expect(lines[3]).toContain("Page two");
    expect(lines[4]).toContain("Page twelve");
  });

  it("quotes fields containing tabs, newlines, or quotes", () => {
    const lines = render([
      hl({ text: 'He said "tab\there"\nnext line' }),
    ]);
    expect(lines[3]).toBe('"He said ""tab\there""');
    expect(lines[4]).toBe('next line"\t\tthink-python');
  });
});

describe("slugifyTag", () => {
  it("lowercases and hyphenates label text into a spaceless Anki tag", () => {
    expect(slugifyTag("Key terms")).toBe("key-terms");
    expect(slugifyTag("  C++ / STL!  ")).toBe("c-stl");
    expect(slugifyTag("---")).toBe("");
  });
});
