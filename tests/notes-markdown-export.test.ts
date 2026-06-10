// Unit tests for rendering a book's highlights + notes into a single portable
// Markdown document. Pure: no DB, no fs, no network — it takes plain data in and
// returns a string, so the eventual delivery target (Obsidian / Notion / Logseq)
// is a separate, decision-blocked concern. This is the target-agnostic core.
import { describe, it, expect } from "vitest";
import { exportAnnotationsMarkdown } from "@/lib/notes/markdown-export";

const EPUB_BOOK = {
  title: "Think Python",
  authors: ["Allen B. Downey"],
  isbn: "9781449330729",
  format: "epub",
};

describe("exportAnnotationsMarkdown — frontmatter", () => {
  it("emits YAML frontmatter with title, author(s), isbn and a source marker", () => {
    const md = exportAnnotationsMarkdown({
      book: EPUB_BOOK,
      highlights: [],
      notes: [],
    });

    expect(md.startsWith("---\n")).toBe(true);
    expect(md).toContain('title: "Think Python"');
    expect(md).toContain("authors:");
    expect(md).toContain("  - Allen B. Downey");
    expect(md).toContain("isbn: 9781449330729");
    expect(md).toContain("source: homelab-reader");
    // frontmatter is a closed block
    expect(md.match(/^---$/gm)?.length).toBeGreaterThanOrEqual(2);
  });

  it("omits absent optional fields — never emits `isbn: undefined`", () => {
    const md = exportAnnotationsMarkdown({
      book: { title: "Untitled Draft", authors: [], format: "pdf" },
      highlights: [],
      notes: [],
    });
    expect(md.toLowerCase()).not.toContain("undefined");
    expect(md).not.toContain("isbn:");
    expect(md).not.toContain("authors:");
    expect(md).toContain('title: "Untitled Draft"');
  });

  it("accepts author objects ({ name }) as well as strings", () => {
    const md = exportAnnotationsMarkdown({
      book: { title: "T", authors: [{ name: "Ada Lovelace" }], format: "epub" },
      highlights: [],
      notes: [],
    });
    expect(md).toContain("  - Ada Lovelace");
  });
});

describe("exportAnnotationsMarkdown — empty", () => {
  it("empty highlights+notes produce a valid doc with frontmatter and no crash", () => {
    const md = exportAnnotationsMarkdown({
      book: EPUB_BOOK,
      highlights: [],
      notes: [],
    });
    expect(md.startsWith("---\n")).toBe(true);
    // no trailing whitespace noise on any line
    expect(md.split("\n").every((l) => l === l.replace(/[ \t]+$/, ""))).toBe(
      true,
    );
  });
});

describe("exportAnnotationsMarkdown — epub highlights with CFI locators", () => {
  it("renders a quote block, the attached note, and a CFI locator line", () => {
    const md = exportAnnotationsMarkdown({
      book: EPUB_BOOK,
      highlights: [
        {
          id: "h1",
          text: "Practicality beats purity.",
          anchor: JSON.stringify({
            type: "epub-cfi-range",
            cfiStart: "/6/14!/4/2/2",
            cfiEnd: "/6/14!/4/2/8",
          }),
          createdAt: new Date("2026-05-01T10:00:00Z"),
        },
      ],
      notes: [],
    });

    expect(md).toContain("> Practicality beats purity.");
    expect(md).toContain("CFI: /6/14!/4/2/2");
  });

  it("renders multiline highlighted text with every line quoted", () => {
    const md = exportAnnotationsMarkdown({
      book: EPUB_BOOK,
      highlights: [
        {
          id: "h1",
          text: "line one\nline two",
          anchor: JSON.stringify({
            type: "epub-cfi-range",
            cfiStart: "/6/2",
            cfiEnd: "/6/4",
          }),
          createdAt: new Date("2026-05-01T10:00:00Z"),
        },
      ],
      notes: [],
    });
    expect(md).toContain("> line one\n> line two");
  });
});

describe("exportAnnotationsMarkdown — pdf page locators", () => {
  it("derives a page-number locator for pdf-rect highlights", () => {
    const md = exportAnnotationsMarkdown({
      book: { title: "RFC Reader", authors: [], format: "pdf" },
      highlights: [
        {
          id: "h1",
          text: "MUST, SHOULD, MAY.",
          anchor: JSON.stringify({
            type: "pdf-rect",
            page: 12,
            rects: [{ x: 0, y: 0, w: 1, h: 1 }],
          }),
          createdAt: new Date("2026-05-01T10:00:00Z"),
        },
      ],
      notes: [],
    });
    expect(md).toContain("> MUST, SHOULD, MAY.");
    expect(md).toContain("Page: 12");
  });
});

describe("exportAnnotationsMarkdown — standalone notes", () => {
  it("renders notes (no highlight) in their own section with locators", () => {
    const md = exportAnnotationsMarkdown({
      book: EPUB_BOOK,
      highlights: [],
      notes: [
        {
          id: "n1",
          body: "Revisit this chapter.",
          anchor: JSON.stringify({ type: "epub-cfi", cfi: "/6/20!/4/2" }),
          context: "the GIL section",
          createdAt: new Date("2026-05-02T09:00:00Z"),
        },
      ],
    });
    expect(md).toContain("## Notes");
    expect(md).toContain("Revisit this chapter.");
    expect(md).toContain("CFI: /6/20!/4/2");
  });

  it("uses a Highlights section heading when highlights are present", () => {
    const md = exportAnnotationsMarkdown({
      book: EPUB_BOOK,
      highlights: [
        {
          id: "h1",
          text: "x",
          anchor: JSON.stringify({
            type: "epub-cfi-range",
            cfiStart: "/6/2",
            cfiEnd: "/6/4",
          }),
          createdAt: new Date("2026-05-01T10:00:00Z"),
        },
      ],
      notes: [],
    });
    expect(md).toContain("## Highlights");
  });
});

describe("exportAnnotationsMarkdown — determinism", () => {
  it("sorts epub highlights by CFI so output is stable regardless of input order", () => {
    const mk = (id: string, cfiStart: string, t: string) => ({
      id,
      text: t,
      anchor: JSON.stringify({ type: "epub-cfi-range", cfiStart, cfiEnd: cfiStart }),
      createdAt: new Date("2026-05-01T10:00:00Z"),
    });
    const a = exportAnnotationsMarkdown({
      book: EPUB_BOOK,
      highlights: [mk("h2", "/6/14", "second"), mk("h1", "/6/2", "first")],
      notes: [],
    });
    const b = exportAnnotationsMarkdown({
      book: EPUB_BOOK,
      highlights: [mk("h1", "/6/2", "first"), mk("h2", "/6/14", "second")],
      notes: [],
    });
    expect(a).toBe(b);
    expect(a.indexOf("first")).toBeLessThan(a.indexOf("second"));
  });

  it("sorts pdf highlights by page number ascending", () => {
    const mk = (id: string, page: number, t: string) => ({
      id,
      text: t,
      anchor: JSON.stringify({ type: "pdf-rect", page, rects: [] }),
      createdAt: new Date("2026-05-01T10:00:00Z"),
    });
    const md = exportAnnotationsMarkdown({
      book: { title: "P", authors: [], format: "pdf" },
      highlights: [mk("h2", 30, "later"), mk("h1", 3, "earlier")],
      notes: [],
    });
    expect(md.indexOf("earlier")).toBeLessThan(md.indexOf("later"));
  });
});
