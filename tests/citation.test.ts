// "References for free": turn the metadata we already enrich into a casual
// human reference and a BibTeX entry — Zotero-grade output, zero forms. Pure.
import { describe, it, expect } from "vitest";
import { formatReference, formatBibtex } from "@/lib/metadata/citation";

const BOOK = {
  title: "Think Python",
  authors: ["Allen B. Downey"],
  publishedYear: 2012,
  publisher: "O'Reilly Media",
  isbn: "9781449330729",
};

describe("formatReference", () => {
  it("renders a casual one-line reference with all parts", () => {
    const ref = formatReference(BOOK);
    expect(ref).toContain("Allen B. Downey");
    expect(ref).toContain("Think Python");
    expect(ref).toContain("O'Reilly Media");
    expect(ref).toContain("2012");
    expect(ref).toContain("9781449330729");
  });

  it("degrades cleanly when fields are missing (no 'undefined', no dangling punctuation)", () => {
    const ref = formatReference({ title: "Untitled Draft", authors: [] });
    expect(ref).toContain("Untitled Draft");
    expect(ref.toLowerCase()).not.toContain("undefined");
    expect(ref).not.toMatch(/,\s*\)/); // no "( , )" style gaps
    expect(ref).not.toMatch(/\(\s*\)/); // no empty parens
  });
});

describe("formatBibtex", () => {
  it("emits a @book entry keyed by first-author-lastname + year", () => {
    const bib = formatBibtex(BOOK);
    expect(bib).toContain("@book{downey2012,");
    expect(bib).toContain("author = {Allen B. Downey}");
    expect(bib).toContain("title = {Think Python}");
    expect(bib).toContain("publisher = {O'Reilly Media}");
    expect(bib).toContain("year = {2012}");
    expect(bib).toContain("isbn = {9781449330729}");
    expect(bib.trimEnd().endsWith("}")).toBe(true);
  });

  it("omits absent fields rather than emitting empty ones", () => {
    const bib = formatBibtex({ title: "Notes", authors: [] });
    expect(bib).toContain("title = {Notes}");
    expect(bib).not.toContain("author = {}");
    expect(bib).not.toContain("year = {}");
    expect(bib).not.toContain("isbn = {}");
  });
});
