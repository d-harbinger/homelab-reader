// Bench for the OpenLibrary title matcher — the evidence behind the
// main-title comparison in `scoreMatch`.
//
// Twenty realistic library titles, each with an OpenLibrary-shaped candidate
// set (the correct record plus the near-miss neighbours the live service
// actually returns alongside it). Everything here is a fixture: the suite
// sends nothing to the live service.
//
// What the bench measures is the precondition for an automatic shelving: the
// top-ranked candidate clearing `AUTO_SHELVE_CONFIDENCE`. Two numbers matter,
// and only one of them is allowed to move up:
//
//   auto-shelved — how many of the twenty would be shelved without review;
//   wrong        — how many of those shelve the WRONG record. Must be zero.
//
// A wrong automatic shelving is silent and lands in a real library, so a false
// positive costs far more here than a missed match. That asymmetry is why the
// three one-word titles at the bottom of the table are left unmatched rather
// than rescued: see the guard tests in tests/openlibrary.test.ts.
import { describe, it, expect } from "vitest";
import { searchOpenLibrary } from "@/lib/metadata/openlibrary";
import { AUTO_SHELVE_CONFIDENCE } from "@/lib/library/auto-shelve";

interface Doc {
  key: string;
  title: string;
  author_name: string[];
}

interface BenchCase {
  /** Title as the scanner extracts it (filenames carry no subtitle). */
  title: string;
  authors: string[];
  /** Work key of the record this book actually is. */
  expect: string;
  /** What OpenLibrary returns for that query, correct record included. */
  docs: Doc[];
}

// --- the bench --------------------------------------------------------------

const BENCH: BenchCase[] = [
  // -- Records OpenLibrary stores without a subtitle: matched before and after.
  {
    title: "Designing Data-Intensive Applications",
    authors: ["Martin Kleppmann"],
    expect: "/works/DDIA",
    docs: [
      { key: "/works/DDIA", title: "Designing Data-Intensive Applications", author_name: ["Martin Kleppmann"] },
      { key: "/works/DIS", title: "Designing Distributed Systems: Patterns and Paradigms for Scalable, Reliable Services", author_name: ["Brendan Burns"] },
    ],
  },
  {
    title: "Structure and Interpretation of Computer Programs",
    authors: ["Harold Abelson"],
    expect: "/works/SICP",
    docs: [
      { key: "/works/SICP", title: "Structure and Interpretation of Computer Programs", author_name: ["Harold Abelson", "Gerald Jay Sussman"] },
      { key: "/works/SICM", title: "Structure and Interpretation of Classical Mechanics", author_name: ["Gerald Jay Sussman", "Jack Wisdom"] },
    ],
  },
  {
    title: "The Rust Programming Language",
    authors: ["Steve Klabnik"],
    expect: "/works/TRPL",
    docs: [
      { key: "/works/TRPL", title: "The Rust Programming Language", author_name: ["Steve Klabnik", "Carol Nichols"] },
      { key: "/works/PROGRUST", title: "Programming Rust: Fast, Safe Systems Development", author_name: ["Jim Blandy"] },
    ],
  },
  {
    title: "Thinking, Fast and Slow",
    authors: ["Daniel Kahneman"],
    expect: "/works/TFAS",
    docs: [
      { key: "/works/TFAS", title: "Thinking, Fast and Slow", author_name: ["Daniel Kahneman"] },
      { key: "/works/NOISE", title: "Noise: A Flaw in Human Judgment", author_name: ["Daniel Kahneman", "Olivier Sibony"] },
    ],
  },
  {
    title: "Programming Pearls",
    authors: ["Jon Bentley"],
    expect: "/works/PEARLS",
    docs: [
      { key: "/works/PEARLS", title: "Programming Pearls", author_name: ["Jon Bentley"] },
      { key: "/works/MOREPEARLS", title: "More Programming Pearls: Confessions of a Coder", author_name: ["Jon Bentley"] },
    ],
  },
  {
    title: "Modern Operating Systems",
    authors: ["Andrew S. Tanenbaum"],
    expect: "/works/MOS",
    docs: [
      { key: "/works/MOS", title: "Modern Operating Systems", author_name: ["Andrew S. Tanenbaum"] },
      { key: "/works/OSTEP", title: "Operating Systems: Three Easy Pieces", author_name: ["Remzi H. Arpaci-Dusseau"] },
    ],
  },
  {
    title: "Introduction to Algorithms",
    authors: ["Thomas H. Cormen"],
    expect: "/works/CLRS",
    docs: [
      { key: "/works/CLRS", title: "Introduction to Algorithms", author_name: ["Thomas H. Cormen", "Charles E. Leiserson", "Ronald L. Rivest", "Clifford Stein"] },
      { key: "/works/ALGOU", title: "Algorithms Unlocked", author_name: ["Thomas H. Cormen"] },
    ],
  },
  {
    title: "The C Programming Language",
    authors: ["Brian W. Kernighan"],
    expect: "/works/KANDR",
    docs: [
      { key: "/works/KANDR", title: "The C Programming Language", author_name: ["Brian W. Kernighan", "Dennis M. Ritchie"] },
      { key: "/works/GOPL", title: "The Go Programming Language", author_name: ["Alan A. A. Donovan", "Brian W. Kernighan"] },
    ],
  },
  {
    title: "Working Effectively with Legacy Code",
    authors: ["Michael C. Feathers"],
    expect: "/works/WELC",
    docs: [
      { key: "/works/WELC", title: "Working Effectively with Legacy Code", author_name: ["Michael C. Feathers"] },
      { key: "/works/LEGACYMS", title: "Legacy Code: Modernizing Mainframe Systems", author_name: ["Someone Else"] },
    ],
  },
  {
    title: "Deep Learning",
    authors: ["Ian Goodfellow"],
    expect: "/works/DLBOOK",
    docs: [
      { key: "/works/DLBOOK", title: "Deep Learning", author_name: ["Ian Goodfellow", "Yoshua Bengio", "Aaron Courville"] },
      { key: "/works/DLPY", title: "Deep Learning with Python", author_name: ["François Chollet"] },
    ],
  },

  // -- Records OpenLibrary stores WITH a subtitle. The full-title comparison
  //    dilutes each of these below the floor; the main-title comparison
  //    recovers them.
  {
    title: "Clean Code",
    authors: ["Robert C. Martin"],
    expect: "/works/CLEANCODE",
    docs: [
      { key: "/works/CLEANCODE", title: "Clean Code: A Handbook of Agile Software Craftsmanship", author_name: ["Robert C. Martin"] },
      { key: "/works/CLEANARCH", title: "Clean Architecture: A Craftsman's Guide to Software Structure and Design", author_name: ["Robert C. Martin"] },
      { key: "/works/CLEANCODER", title: "The Clean Coder: A Code of Conduct for Professional Programmers", author_name: ["Robert C. Martin"] },
    ],
  },
  {
    title: "The Pragmatic Programmer",
    authors: ["Andrew Hunt"],
    expect: "/works/TPP",
    docs: [
      { key: "/works/TPP", title: "The Pragmatic Programmer: From Journeyman to Master", author_name: ["Andrew Hunt", "David Thomas"] },
      { key: "/works/PRAGTHINK", title: "Pragmatic Thinking and Learning: Refactor Your Wetware", author_name: ["Andy Hunt"] },
    ],
  },
  {
    title: "Design Patterns",
    authors: ["Erich Gamma"],
    expect: "/works/GOF",
    docs: [
      { key: "/works/GOF", title: "Design Patterns: Elements of Reusable Object-Oriented Software", author_name: ["Erich Gamma", "Richard Helm", "Ralph Johnson", "John Vlissides"] },
      { key: "/works/HFDP", title: "Head First Design Patterns: A Brain-Friendly Guide", author_name: ["Eric Freeman", "Elisabeth Robson"] },
      { key: "/works/POSA", title: "Pattern-Oriented Software Architecture: A System of Patterns", author_name: ["Frank Buschmann"] },
    ],
  },
  {
    title: "Domain-Driven Design",
    authors: ["Eric Evans"],
    expect: "/works/DDD",
    docs: [
      { key: "/works/DDD", title: "Domain-Driven Design: Tackling Complexity in the Heart of Software", author_name: ["Eric Evans"] },
      { key: "/works/IDDD", title: "Implementing Domain-Driven Design", author_name: ["Vaughn Vernon"] },
      { key: "/works/DDDDIST", title: "Domain-Driven Design Distilled", author_name: ["Vaughn Vernon"] },
    ],
  },
  {
    title: "The Mythical Man-Month",
    authors: ["Frederick P. Brooks"],
    expect: "/works/MMM",
    docs: [
      { key: "/works/MMM", title: "The Mythical Man-Month: Essays on Software Engineering", author_name: ["Frederick P. Brooks"] },
      { key: "/works/DESIGNOF", title: "The Design of Design: Essays from a Computer Scientist", author_name: ["Frederick P. Brooks"] },
    ],
  },
  {
    title: "Eloquent JavaScript",
    authors: ["Marijn Haverbeke"],
    expect: "/works/EJS",
    docs: [
      { key: "/works/EJS", title: "Eloquent JavaScript: A Modern Introduction to Programming", author_name: ["Marijn Haverbeke"] },
      { key: "/works/JSGOOD", title: "JavaScript: The Good Parts", author_name: ["Douglas Crockford"] },
      { key: "/works/ELOQRUBY", title: "Eloquent Ruby", author_name: ["Russ Olsen"] },
    ],
  },
  {
    title: "Site Reliability Engineering",
    authors: ["Betsy Beyer"],
    expect: "/works/SRE",
    docs: [
      { key: "/works/SRE", title: "Site Reliability Engineering: How Google Runs Production Systems", author_name: ["Betsy Beyer", "Chris Jones", "Jennifer Petoff", "Niall Richard Murphy"] },
      { key: "/works/SREWB", title: "The Site Reliability Workbook: Practical Ways to Implement SRE", author_name: ["Betsy Beyer", "Niall Richard Murphy"] },
    ],
  },

  // -- One-word main titles. The two-shared-token guard refuses to let a
  //    single word carry a match, so these stay unmatched on purpose — the
  //    same rule that stops a bare "Python" from shelving an arbitrary Python
  //    primer. A human confirms them in the review queue.
  {
    title: "Refactoring",
    authors: ["Martin Fowler"],
    expect: "/works/REFACTORING",
    docs: [
      { key: "/works/REFACTORING", title: "Refactoring: Improving the Design of Existing Code", author_name: ["Martin Fowler"] },
      { key: "/works/REFPATTERNS", title: "Refactoring to Patterns", author_name: ["Joshua Kerievsky"] },
      { key: "/works/REFJS", title: "Refactoring JavaScript: Turning Bad Code into Good Code", author_name: ["Evan Burchard"] },
    ],
  },
  {
    title: "Sapiens",
    authors: ["Yuval Noah Harari"],
    expect: "/works/SAPIENS",
    docs: [
      { key: "/works/SAPIENS", title: "Sapiens: A Brief History of Humankind", author_name: ["Yuval Noah Harari"] },
      { key: "/works/HOMODEUS", title: "Homo Deus: A Brief History of Tomorrow", author_name: ["Yuval Noah Harari"] },
    ],
  },
  {
    title: "Code",
    authors: ["Charles Petzold"],
    expect: "/works/CODE",
    docs: [
      { key: "/works/CODE", title: "Code: The Hidden Language of Computer Hardware and Software", author_name: ["Charles Petzold"] },
      { key: "/works/CODECOMPLETE", title: "Code Complete: A Practical Handbook of Software Construction", author_name: ["Steve McConnell"] },
    ],
  },
];

// --- harness ----------------------------------------------------------------

/** A fetch that answers with a fixed candidate list, honouring `limit`. */
function fixtureFetch(docs: Doc[]): typeof fetch {
  return (async (url: string) => {
    const lim = Number(new URL(url).searchParams.get("limit") ?? "5");
    return { ok: true, status: 200, json: async () => ({ docs: docs.slice(0, lim) }) };
  }) as unknown as typeof fetch;
}

interface BenchResult {
  autoShelved: number;
  wrong: string[];
  missed: string[];
}

async function runBench(cases: BenchCase[]): Promise<BenchResult> {
  const wrong: string[] = [];
  const missed: string[] = [];
  let autoShelved = 0;

  for (const c of cases) {
    const ranked = await searchOpenLibrary(
      { title: c.title, authors: c.authors },
      { fetchImpl: fixtureFetch(c.docs) },
    );
    const top = ranked[0];
    if (!top || top.confidence < AUTO_SHELVE_CONFIDENCE) {
      missed.push(c.title);
      continue;
    }
    autoShelved++;
    if (top.workKey !== c.expect) wrong.push(c.title);
  }

  return { autoShelved, wrong, missed };
}

// --- assertions -------------------------------------------------------------

describe("OpenLibrary matcher bench (20 titles, fixtures only)", () => {
  it("shelves seventeen of twenty and shelves nothing wrongly", async () => {
    const result = await runBench(BENCH);

    // Exact rather than a floor: this table is the record of what the
    // main-title comparison bought (10 → 17) and what it deliberately left
    // behind. A change to any of the three numbers wants an explanation.
    expect(result).toEqual({
      autoShelved: 17,
      wrong: [],
      missed: ["Refactoring", "Sapiens", "Code"],
    });
  });

  it("keeps the twenty cases distinct so the count means something", () => {
    expect(new Set(BENCH.map((c) => c.title)).size).toBe(20);
  });
});
