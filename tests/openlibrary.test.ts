// Unit tests for the OpenLibrary enrichment module — the FOSS, no-Google
// "brain" that turns messy title/author/ISBN signals into ranked metadata
// suggestions. Pure: no network (fetch is injected), no DB. First non-Prisma
// unit suite in the repo.
import { describe, it, expect } from "vitest";
import { searchOpenLibrary, scoreMatch } from "@/lib/metadata/openlibrary";

// A canned OpenLibrary /search.json response (trimmed to the fields we read).
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
      title: "Thinking in Python",
      author_name: ["Someone Else"],
      first_publish_year: 2001,
      cover_i: 6789,
      subject: ["Programming"],
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

describe("scoreMatch", () => {
  it("scores an exact title+author match high and a weak match lower", () => {
    const strong = scoreMatch(
      { title: "Think Python", authors: ["Allen Downey"] },
      { title: "Think Python", authors: ["Allen B. Downey"] },
    );
    const weak = scoreMatch(
      { title: "Think Python", authors: ["Allen Downey"] },
      { title: "Thinking in Python", authors: ["Someone Else"] },
    );
    expect(strong).toBeGreaterThan(0.7);
    expect(strong).toBeGreaterThan(weak);
  });

  it("is case- and punctuation-insensitive on the title", () => {
    const s = scoreMatch(
      { title: "  think_python! " },
      { title: "Think Python", authors: [] },
    );
    expect(s).toBeGreaterThan(0.9);
  });
});

describe("searchOpenLibrary", () => {
  it("maps OpenLibrary docs to ranked suggestions, best match first", async () => {
    const out = await searchOpenLibrary(
      { title: "Think Python", authors: ["Allen Downey"] },
      { fetchImpl: fetchReturning(SAMPLE) },
    );

    expect(out).toHaveLength(2);
    const top = out[0];
    expect(top.source).toBe("openlibrary");
    expect(top.title).toBe("Think Python");
    expect(top.authors).toContain("Allen B. Downey");
    expect(top.publishedYear).toBe(2012);
    expect(top.isbn).toBe("9781449330729"); // first ISBN
    expect(top.publisher).toBe("O'Reilly Media");
    expect(top.coverUrl).toContain("12345");
    expect(top.workKey).toBe("/works/OL45883W");
    expect(top.confidence).toBeGreaterThan(out[1].confidence);
  });

  it("returns [] on a non-ok response instead of throwing", async () => {
    const out = await searchOpenLibrary(
      { title: "anything" },
      { fetchImpl: fetchReturning({}, false, 503) },
    );
    expect(out).toEqual([]);
  });

  it("returns [] (never throws) when fetch itself rejects", async () => {
    const throwingFetch = (async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch;
    const out = await searchOpenLibrary(
      { title: "anything" },
      { fetchImpl: throwingFetch },
    );
    expect(out).toEqual([]);
  });
});
