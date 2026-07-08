// Unit tests for the enrichment composer — the connective tissue that wires the
// two shipped-but-dormant halves together: parseFilenameSignals (filename →
// title/ISBN signals) feeding searchOpenLibrary (→ ranked MetadataSuggestion[]).
// Plus the two pure decision helpers the scan hook and review screen will lean
// on: isThin (D-3a, "is this book's metadata weak enough to enrich?") and
// applyAcceptance (D-3d, "what does accepting this suggestion change?").
//
// Pure: fetch is injected, no DB, no network. Mirrors openlibrary.test.ts.
import { describe, it, expect } from "vitest";
import { enrichBook, isThin, applyAcceptance } from "@/lib/metadata/enrich";
import type { MetadataSuggestion } from "@/lib/metadata/openlibrary";

// A canned OpenLibrary /search.json response (trimmed to the fields we read).
// Two docs so confidence ranking has something to sort; the messy filename
// "Downey - Think Python 9781449330729.pdf" should match the first far better.
const SAMPLE = {
  numFound: 2,
  docs: [
    {
      key: "/works/OL45883W",
      title: "Think Python",
      author_name: ["Allen B. Downey"],
      first_publish_year: 2012,
      isbn: ["9781449330729", "1449330720"],
      cover_i: 12345,
      publisher: ["O'Reilly Media"],
      subject: ["Python (Computer program language)", "Computer programming"],
    },
    {
      key: "/works/OL999W",
      title: "Cooking for Geeks",
      author_name: ["Jeff Potter"],
      first_publish_year: 2010,
      cover_i: 6789,
      subject: ["Cooking"],
    },
  ],
};

function fetchReturning(body: unknown, ok = true, status = 200): typeof fetch {
  return (async () => ({
    ok,
    status,
    json: async () => body,
  })) as unknown as typeof fetch;
}

function fetchThrowing(): typeof fetch {
  return (async () => {
    throw new Error("network down");
  }) as unknown as typeof fetch;
}

describe("enrichBook", () => {
  it("turns a messy filename into ranked suggestions (best confidence first)", async () => {
    const suggestions = await enrichBook(
      "/books/Downey - Think Python 9781449330729.pdf",
      fetchReturning(SAMPLE),
    );

    expect(suggestions.length).toBeGreaterThan(0);
    // Ranked: the Think Python doc must come first, ahead of the unrelated one.
    expect(suggestions[0].title).toBe("Think Python");
    expect(suggestions[0].isbn).toBe("9781449330729");
    // Monotonically non-increasing confidence (already sorted by the lib).
    for (let i = 1; i < suggestions.length; i++) {
      expect(suggestions[i - 1].confidence).toBeGreaterThanOrEqual(
        suggestions[i].confidence,
      );
    }
  });

  it("returns [] when OpenLibrary has no matches", async () => {
    const suggestions = await enrichBook(
      "/books/Something Obscure.epub",
      fetchReturning({ numFound: 0, docs: [] }),
    );
    expect(suggestions).toEqual([]);
  });

  it("returns [] when the filename yields no usable signals", async () => {
    // A basename that reduces to nothing should never even hit the network,
    // but if it did, the result is still []. Use a throwing fetch to prove the
    // short-circuit path is harmless too.
    const suggestions = await enrichBook("/books/.epub", fetchThrowing());
    expect(suggestions).toEqual([]);
  });

  it("never throws — a failing fetch resolves to []", async () => {
    const suggestions = await enrichBook(
      "/books/Downey - Think Python.pdf",
      fetchThrowing(),
    );
    expect(suggestions).toEqual([]);
  });

  // Noise suppression: OpenLibrary's title search returns SOMETHING for almost
  // any query, so a book with a poor filename signal (e.g. "tlcl.pdf") comes
  // back matched to unrelated works at near-zero confidence. Surfacing those
  // clutters the review panel and invites accepting wrong metadata. enrichBook
  // drops anything below MIN_SUGGESTION_CONFIDENCE so only plausible matches
  // reach the panel.
  it("drops candidates whose confidence is below the floor (all noise → [])", async () => {
    // The real-world case: "The Linux Command Line" matched OpenLibrary's
    // Thallium (Tl-Cl) chemistry/medical papers — zero shared tokens.
    const noise = {
      numFound: 3,
      docs: [
        { key: "/works/A", title: "Étude des excitations électroniques", author_name: ["B. Brousseau"] },
        { key: "/works/B", title: "Molecular beam magnetic resonance spectra", author_name: ["H. Zeiger"] },
        { key: "/works/C", title: "Thallium-201 Myokard-ECT Untersuchungsprotokoll", author_name: ["J. Bathmann"] },
      ],
    };
    const suggestions = await enrichBook(
      "/books/The Linux Command Line.pdf",
      fetchReturning(noise),
    );
    expect(suggestions).toEqual([]);
  });

  it("keeps a confident match while dropping the noise beside it", async () => {
    const mixed = {
      numFound: 2,
      docs: [
        { key: "/works/good", title: "The Linux Command Line", author_name: ["William Shotts"], first_publish_year: 2019 },
        { key: "/works/bad", title: "Thallium Chemistry Handbook", author_name: ["Someone Else"] },
      ],
    };
    const suggestions = await enrichBook(
      "/books/The Linux Command Line.pdf",
      fetchReturning(mixed),
    );
    expect(suggestions.length).toBe(1);
    expect(suggestions[0].title).toBe("The Linux Command Line");
    expect(suggestions[0].confidence).toBeGreaterThanOrEqual(0.1);
  });
});

describe("isThin", () => {
  const wellTagged = {
    title: "Think Python",
    filePath: "/books/Downey - Think Python 9781449330729.pdf",
    isbn: "9781449330729",
    authors: [{ name: "Allen B. Downey" }],
  };

  it("is false for a well-tagged book (isbn + author + real title)", () => {
    expect(isThin(wellTagged)).toBe(false);
  });

  it("is true when the book has no isbn", () => {
    expect(isThin({ ...wellTagged, isbn: null })).toBe(true);
  });

  it("is true when the title equals the filename fallback", () => {
    // The fallback for this path is "Downey Think Python" (hyphens become
    // separators, ISBN stripped). A title that exactly equals that fallback
    // means nothing better than the filename was ever extracted → thin.
    expect(
      isThin({
        ...wellTagged,
        title: "Downey Think Python",
      }),
    ).toBe(true);
  });

  it("is true when the book has no author", () => {
    expect(isThin({ ...wellTagged, authors: [] })).toBe(true);
    expect(isThin({ ...wellTagged, authors: null })).toBe(true);
  });
});

describe("applyAcceptance", () => {
  const suggestion: MetadataSuggestion = {
    source: "openlibrary",
    confidence: 0.92,
    title: "Think Python",
    authors: ["Allen B. Downey"],
    publishedYear: 2012,
    publisher: "O'Reilly Media",
    isbn: "9781449330729",
    subjects: ["Python (Computer program language)", "Computer programming"],
    coverUrl: "https://covers.openlibrary.org/b/id/12345-M.jpg",
    workKey: "/works/OL45883W",
  };

  it("fills an empty isbn", () => {
    const diff = applyAcceptance({ isbn: null }, suggestion, { force: false });
    expect(diff.isbn).toBe("9781449330729");
  });

  it("does NOT clobber a present title unless force is set", () => {
    const book = { title: "My Own Title", isbn: null };
    const diff = applyAcceptance(book, suggestion, { force: false });
    expect(diff.title).toBeUndefined();
  });

  it("overwrites a present title when force is set", () => {
    const book = { title: "My Own Title", isbn: null };
    const diff = applyAcceptance(book, suggestion, { force: true });
    expect(diff.title).toBe("Think Python");
  });

  it("maps subjects to tag names", () => {
    const diff = applyAcceptance({}, suggestion, { force: false });
    expect(diff.tagNames).toEqual([
      "Python (Computer program language)",
      "Computer programming",
    ]);
  });

  it("fills empty-only per field: empty publisher filled, present one kept", () => {
    const diff = applyAcceptance(
      { publisher: "Existing Press", description: null },
      suggestion,
      { force: false },
    );
    // present publisher kept
    expect(diff.publisher).toBeUndefined();
    // no description on the suggestion → nothing to fill, no key emitted
    expect("description" in diff).toBe(false);
  });

  it("maps publishedYear to a publishedAt Date in an empty field", () => {
    const diff = applyAcceptance({ publishedAt: null }, suggestion, {
      force: false,
    });
    expect(diff.publishedAt).toBeInstanceOf(Date);
    expect(diff.publishedAt?.getUTCFullYear()).toBe(2012);
  });

  it("does not emit a field when the suggestion carries no value for it", () => {
    const sparse: MetadataSuggestion = {
      source: "openlibrary",
      confidence: 0.4,
      authors: [],
      subjects: [],
    };
    const diff = applyAcceptance({ isbn: null, title: "Keep" }, sparse, {
      force: false,
    });
    expect("isbn" in diff).toBe(false);
    expect("title" in diff).toBe(false);
    expect(diff.tagNames).toBeUndefined();
  });
});
