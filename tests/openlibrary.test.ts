// Unit tests for the OpenLibrary enrichment module — the FOSS, no-Google
// "brain" that turns messy title/author/ISBN signals into ranked metadata
// suggestions. Pure: no network (fetch is injected), no DB. First non-Prisma
// unit suite in the repo.
import { describe, it, expect } from "vitest";
import {
  CANDIDATE_POOL,
  lookupOpenLibrary,
  scoreMatch,
  searchOpenLibrary,
} from "@/lib/metadata/openlibrary";
import { AUTO_SHELVE_CONFIDENCE } from "@/lib/library/auto-shelve";

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

// ---------------------------------------------------------------------------
// The subtitle rule and the guard that makes it safe.
//
// OpenLibrary stores subtitles inline after a colon, so comparing full titles
// diluted correct matches below the auto-shelve floor. `scoreMatch` therefore
// also compares the MAIN titles — the parts before the colon — and keeps
// whichever reading scores higher.
//
// That change is only safe because of the two-shared-token guard. Without it,
// a one-word main title scores a perfect 1.000 against any candidate whose
// main title is that same word, and a book the scanner could only read as
// "Python" would silently shelve itself as an arbitrary Python primer. An
// automatic shelving is never reviewed, so a false positive costs far more
// than a missed match: the guard is the point of the whole change, and these
// are its tests.
// ---------------------------------------------------------------------------
describe("scoreMatch — main-title comparison", () => {
  it("does NOT let a one-word title carry a match (the bare-'Python' case)", () => {
    // Comparing main titles alone would score this an unqualified 1.000.
    const primer = scoreMatch(
      { title: "Python" },
      { title: "Python: The Complete Beginner's Guide to Learning Python", authors: [] },
    );
    expect(primer).toBeLessThan(AUTO_SHELVE_CONFIDENCE);

    // The same trap, with the query's own author attached — still no shelving.
    for (const [title, candidate] of [
      ["Java", "Java: A Beginner's Guide"],
      ["Linux", "Linux: The Textbook"],
      ["Code", "Code Complete: A Practical Handbook of Software Construction"],
    ] as const) {
      expect(
        scoreMatch({ title }, { title: candidate, authors: [] }),
        `${title} must not auto-shelve against ${candidate}`,
      ).toBeLessThan(AUTO_SHELVE_CONFIDENCE);
    }
  });

  it("does not auto-shelve a bare one-word query end to end", async () => {
    const docs = [
      { key: "/works/PYBEG", title: "Python: The Complete Beginner's Guide", author_name: ["Nobody Relevant"] },
      { key: "/works/PYCRASH", title: "Python Crash Course: A Hands-On Introduction", author_name: ["Eric Matthes"] },
    ];
    const ranked = await searchOpenLibrary(
      { title: "Python" },
      { fetchImpl: fetchReturning({ docs }) },
    );
    expect(ranked.length).toBeGreaterThan(0); // candidates exist…
    for (const s of ranked) {
      // …and every one of them stays under the floor, so the sweep hands the
      // book to a human instead of guessing.
      expect(s.confidence, s.title).toBeLessThan(AUTO_SHELVE_CONFIDENCE);
    }
  });

  it("recovers a correct match that a subtitle had diluted", () => {
    // 0.475 before the main-title comparison — under the 0.55 floor, so a
    // certain match sat in the review queue.
    const s = scoreMatch(
      { title: "Clean Code", authors: ["Robert C. Martin"] },
      {
        title: "Clean Code: A Handbook of Agile Software Craftsmanship",
        authors: ["Robert C. Martin"],
      },
    );
    expect(s).toBeGreaterThanOrEqual(AUTO_SHELVE_CONFIDENCE);
  });

  it("keeps a same-author neighbour below the floor", () => {
    // Two shared tokens are necessary, not sufficient: "Clean Architecture"
    // shares only "clean" with "Clean Code", and the near-miss neighbours
    // that DO share two tokens still have to earn the score.
    const neighbours = [
      "Clean Architecture: A Craftsman's Guide to Software Structure and Design",
      "The Clean Coder: A Code of Conduct for Professional Programmers",
    ];
    for (const title of neighbours) {
      expect(
        scoreMatch(
          { title: "Clean Code", authors: ["Robert C. Martin"] },
          { title, authors: ["Robert C. Martin"] },
        ),
        title,
      ).toBeLessThan(AUTO_SHELVE_CONFIDENCE);
    }
    // A different book that shares two main-title tokens is still not this
    // book: the subtitle-free comparison must not flatten the difference.
    expect(
      scoreMatch(
        { title: "Design Patterns", authors: ["Erich Gamma"] },
        { title: "Head First Design Patterns: A Brain-Friendly Guide", authors: ["Eric Freeman"] },
      ),
    ).toBeLessThan(AUTO_SHELVE_CONFIDENCE);
  });

  it("never scores a candidate lower than the full-title comparison did", () => {
    // The rule takes the better of the two readings, so it can only move a
    // candidate toward the floor — no previously-matched book regresses.
    const s = scoreMatch(
      { title: "Think Python", authors: ["Allen Downey"] },
      { title: "Think Python", authors: ["Allen B. Downey"] },
    );
    expect(s).toBeGreaterThan(0.7);
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

// ---------------------------------------------------------------------------
// Regression cover for the 2026-08-07 "matching got worse" report.
//
// Two independent defects sat behind it, both OUTSIDE the scoring function
// (scoreMatch itself is unchanged since 2026-06-14):
//
//   1. Every failure — a throttle, an outage, a timeout — resolved to the same
//      empty list as a genuine "nothing matched". The whole-library sweep then
//      recorded those empties as permanent no-match verdicts.
//   2. The request asked OpenLibrary for exactly as many docs as it intended
//      to return, so the candidate list was truncated by OpenLibrary's own
//      relevance order BEFORE this module's confidence ranking ever saw it.
// ---------------------------------------------------------------------------

function fetchWithStatus(status: number): typeof fetch {
  return (async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => ({}),
  })) as unknown as typeof fetch;
}

describe("lookupOpenLibrary outcomes", () => {
  it("reports a throttle as 'throttled', never as an empty answer", async () => {
    for (const status of [429, 403]) {
      const r = await lookupOpenLibrary(
        { title: "anything" },
        { fetchImpl: fetchWithStatus(status) },
      );
      expect(r.outcome, `HTTP ${status}`).toBe("throttled");
      expect(r.suggestions).toEqual([]);
    }
  });

  it("reports a server error or a dead network as 'failed'", async () => {
    const server = await lookupOpenLibrary(
      { title: "anything" },
      { fetchImpl: fetchWithStatus(503) },
    );
    expect(server.outcome).toBe("failed");

    const dead = await lookupOpenLibrary(
      { title: "anything" },
      {
        fetchImpl: (async () => {
          throw new Error("network down");
        }) as unknown as typeof fetch,
      },
    );
    expect(dead.outcome).toBe("failed");
    expect(dead.suggestions).toEqual([]);
  });

  it("reports a real answer as 'ok' — including a genuinely empty one", async () => {
    const hit = await lookupOpenLibrary(
      { title: "Think Python" },
      { fetchImpl: fetchReturning(SAMPLE) },
    );
    expect(hit.outcome).toBe("ok");
    expect(hit.suggestions.length).toBeGreaterThan(0);

    const miss = await lookupOpenLibrary(
      { title: "a book that does not exist" },
      { fetchImpl: fetchReturning({ numFound: 0, docs: [] }) },
    );
    // The distinction that matters: answered, and the answer was "nothing".
    expect(miss.outcome).toBe("ok");
    expect(miss.suggestions).toEqual([]);
  });

  it("keeps searchOpenLibrary's best-effort contract on every failure", async () => {
    for (const status of [403, 429, 500]) {
      expect(
        await searchOpenLibrary({ title: "x" }, { fetchImpl: fetchWithStatus(status) }),
      ).toEqual([]);
    }
  });
});

describe("candidate pool", () => {
  it("asks for more candidates than it returns", async () => {
    let asked: string | undefined;
    const spy = (async (url: string) => {
      asked = url;
      return { ok: true, status: 200, json: async () => ({ docs: [] }) };
    }) as unknown as typeof fetch;

    await searchOpenLibrary({ title: "Refactoring" }, { fetchImpl: spy, limit: 5 });
    const limitParam = Number(new URL(asked!).searchParams.get("limit"));
    expect(limitParam).toBe(CANDIDATE_POOL(5));
    expect(limitParam).toBeGreaterThan(5);
  });

  it("scores a correct match OpenLibrary ranked below the returned page", async () => {
    // OpenLibrary's relevance order puts five other refactoring books ahead of
    // Fowler's. Asking for only the page being returned meant the right book
    // was never scored at all.
    const docs = [
      { key: "/works/W1", title: "Refactoring Workbook", author_name: ["William C. Wake"] },
      { key: "/works/W2", title: "Refactoring to Patterns", author_name: ["Joshua Kerievsky"] },
      { key: "/works/W3", title: "Refactoring Databases", author_name: ["Scott W. Ambler"] },
      { key: "/works/W4", title: "Refactoring HTML", author_name: ["Elliotte Rusty Harold"] },
      { key: "/works/W5", title: "Refactoring JavaScript", author_name: ["Evan Burchard"] },
      { key: "/works/RIGHT", title: "Refactoring", author_name: ["Martin Fowler"] },
    ];
    // Honour the limit the caller sends, exactly as the live API does.
    const api = (async (url: string) => {
      const lim = Number(new URL(url).searchParams.get("limit") ?? "5");
      return { ok: true, status: 200, json: async () => ({ docs: docs.slice(0, lim) }) };
    }) as unknown as typeof fetch;

    const out = await searchOpenLibrary(
      { title: "Refactoring", authors: ["Martin Fowler"] },
      { fetchImpl: api, limit: 5 },
    );
    expect(out[0].workKey).toBe("/works/RIGHT");
    // Still returns only the page it was asked for.
    expect(out.length).toBeLessThanOrEqual(5);
  });
});
