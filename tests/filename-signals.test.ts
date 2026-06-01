// Unit tests for turning a messy book filename into enrichment signals
// (title + ISBN) to feed OpenLibrary. Pure: no network, no DB.
import { describe, it, expect } from "vitest";
import { parseFilenameSignals } from "@/lib/metadata/filename-signals";

describe("parseFilenameSignals", () => {
  it("cleans separators and the extension into a readable title", () => {
    const q = parseFilenameSignals(
      "/books/Project_Management_all-in-one_for_dummies.pdf",
    );
    expect(q.title).toBe("Project Management all in one for dummies");
    expect(q.isbn).toBeUndefined();
  });

  it("extracts an ISBN-13 from the filename and strips it from the title", () => {
    const q = parseFilenameSignals("Downey - Think Python 9781449330729.pdf");
    expect(q.isbn).toBe("9781449330729");
    expect(q.title).toContain("Think Python");
    expect(q.title).not.toContain("9781449330729");
  });

  it("extracts a hyphenated ISBN-13", () => {
    const q = parseFilenameSignals("Clean Code 978-0-13-235088-4.epub");
    expect(q.isbn).toBe("9780132350884");
    expect(q.title).toContain("Clean Code");
  });

  it("strips common download-site noise like (z-lib.org)", () => {
    const q = parseFilenameSignals("/x/Clean Code (z-lib.org).epub");
    expect(q.title).toBe("Clean Code");
  });

  it("uses only the basename, never directory segments", () => {
    const q = parseFilenameSignals("/books/9781449330729/cover/intro.epub");
    expect(q.title).toBe("intro");
    expect(q.isbn).toBeUndefined(); // the dir ISBN must NOT leak in
  });
});
