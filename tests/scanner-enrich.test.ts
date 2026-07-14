// ENRICH-ON-IMPORT (D3, Slice 3) — the scan hook that stores ranked OpenLibrary
// suggestions against a freshly imported THIN book, plus a migration round-trip
// proving the hand-written BookSuggestion CREATE TABLE is valid SQL.
//
// Seam (mirrors tests/scanner.test.ts, strategy b): a vi.hoisted() ephemeral
// PrismaClient on a temp SQLite file (injected via vi.mock("@/lib/prisma")), the
// committed migrations applied in beforeAll. Two extra seams this file owns:
//   - vi.mock("@/lib/scanner/epub"): the committed fixtures are all thin (no
//     ISBN), so the ONLY way to drive a deterministic NON-thin book through
//     scanFile is to control the extracted metadata. scanner.test.ts keeps the
//     real extractor for its branch fidelity; this file mocks it for thin/
//     non-thin control. A real fixture file still backs fileHash/fs.stat.
//   - vi.stubGlobal("fetch", …): the enrich hook reads globalThis.fetch at call
//     time (the non-forking injection seam — scanFile's signature is unchanged),
//     so canned OpenLibrary JSON is injected here without touching the network.

import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
  vi,
} from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const h = await vi.hoisted(async () => {
  const { mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const path = (await import("node:path")).default;
  const { PrismaClient } = await import("@prisma/client");
  const dir = mkdtempSync(path.join(tmpdir(), "hlr-enrich-"));
  const dbFile = path.join(dir, "test.db");
  const url = `file:${dbFile}`;
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  return { dir, url, prisma };
});

vi.mock("@/lib/prisma", () => ({ prisma: h.prisma }));
vi.mock("@/lib/scanner/covers", () => ({
  writeCover: vi.fn(async () => "cover-stub.jpg"),
}));
// Controllable extractor: each test sets extractEpub's return to make the
// created book thin or non-thin. The default is overwritten per test.
vi.mock("@/lib/scanner/epub", () => ({
  extractEpub: vi.fn(),
}));

import { scanFile } from "@/lib/scanner/index";
import { extractEpub } from "@/lib/scanner/epub";

const FIXTURES = path.join(__dirname, "fixtures");
const VALID_EPUB = path.join(FIXTURES, "valid.epub");

let lib: string;

function stage(asName: string): string {
  const dest = path.join(lib, asName);
  copyFileSync(VALID_EPUB, dest); // a real file for fileHash/fs.stat
  return dest;
}

// A canned OpenLibrary /search.json response with `docs`.
function olFetch(docs: unknown[]) {
  return vi.fn(async () => new Response(JSON.stringify({ docs }), { status: 200 }));
}

// One well-formed OpenLibrary doc → maps to a high-value BookSuggestion.
const CLEAN_DOC = {
  key: "/works/OL45883W",
  title: "Clean Code",
  author_name: ["Robert C. Martin"],
  first_publish_year: 2008,
  isbn: ["9780132350884"],
  cover_i: 12345,
  publisher: ["Prentice Hall"],
  subject: ["Software engineering", "Computer programming"],
};

// extractEpub return shapes (the fields extractFor reads).
const THIN_META = {
  title: "book", // equals the filename fallback → thin even ignoring isbn
  authors: [] as string[],
  language: undefined,
  publisher: undefined,
  description: undefined,
  publishedAt: undefined,
  isbn: undefined, // no ISBN → thin
  subjects: [] as string[],
  cover: undefined,
};

const FULL_META = {
  title: "Deep Work", // != filename fallback
  authors: ["Cal Newport"], // has author
  language: "en",
  publisher: "Grand Central",
  description: "Rules for focused success.",
  publishedAt: new Date("2016-01-05T00:00:00.000Z"),
  isbn: "9781455586691", // has ISBN → NOT thin
  subjects: [] as string[],
  cover: undefined,
};

beforeAll(() => {
  execFileSync("npx", ["prisma", "migrate", "deploy"], {
    env: { ...process.env, DATABASE_URL: h.url },
    stdio: "inherit",
  });
});

afterAll(async () => {
  await h.prisma.$disconnect();
  rmSync(h.dir, { recursive: true, force: true });
});

beforeEach(async () => {
  vi.clearAllMocks();
  lib = mkdtempSync(path.join(tmpdir(), "hlr-enrich-lib-"));
  await h.prisma.bookSuggestion.deleteMany();
  await h.prisma.book.deleteMany();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("BookSuggestion migration round-trip (Slice 1 SQL validity)", () => {
  it("a row can be created and read back (proves the hand-written CREATE TABLE)", async () => {
    const book = await h.prisma.book.create({
      data: { filePath: "/seed/round.epub", format: "epub", title: "Seed" },
    });
    const row = await h.prisma.bookSuggestion.create({
      data: {
        bookId: book.id,
        source: "openlibrary",
        confidence: 0.91,
        title: "Clean Code",
        authors: JSON.stringify(["Robert C. Martin"]),
        subjects: JSON.stringify(["Software engineering"]),
        isbn: "9780132350884",
        publishedYear: 2008,
        publisher: "Prentice Hall",
        coverUrl: "https://covers.openlibrary.org/b/id/12345-M.jpg",
        workKey: "/works/OL45883W",
      },
    });

    const read = await h.prisma.bookSuggestion.findUnique({ where: { id: row.id } });
    expect(read).not.toBeNull();
    expect(read!.status).toBe("pending"); // schema default
    expect(read!.confidence).toBeCloseTo(0.91);
    expect(JSON.parse(read!.authors)).toEqual(["Robert C. Martin"]);
    expect(read!.bookId).toBe(book.id);
  });

  it("cascades: deleting the Book removes its suggestions (onDelete: Cascade)", async () => {
    const book = await h.prisma.book.create({
      data: { filePath: "/seed/cascade.epub", format: "epub", title: "Seed" },
    });
    await h.prisma.bookSuggestion.create({
      data: {
        bookId: book.id,
        source: "openlibrary",
        confidence: 0.5,
        authors: "[]",
        subjects: "[]",
      },
    });
    await h.prisma.book.delete({ where: { id: book.id } });
    expect(await h.prisma.bookSuggestion.count()).toBe(0);
  });
});

describe("scanFile enrich hook (Slice 3)", () => {
  // Enrichment is consent-gated (default OFF — the setup-time privacy
  // choice); these tests exercise the enabled path, so opt the test DB in.
  beforeEach(async () => {
    await h.prisma.appSetting.upsert({
      where: { key: "onlineLookups" },
      update: { value: "on" },
      create: { key: "onlineLookups", value: "on" },
    });
  });

  it("consent gate: with online lookups OFF (the default), no lookup fires and no rows appear", async () => {
    await h.prisma.appSetting.delete({ where: { key: "onlineLookups" } });
    vi.mocked(extractEpub).mockResolvedValue(THIN_META as never);
    const spy = olFetch([CLEAN_DOC]);
    vi.stubGlobal("fetch", spy);

    await scanFile(stage("Clean Code.epub"));

    expect(spy).not.toHaveBeenCalled();
    expect(await h.prisma.bookSuggestion.count()).toBe(0);
    expect(await h.prisma.book.count()).toBe(1); // the import itself still lands
  });

  it("THIN new book + injected fetch → BookSuggestion rows created and mapped", async () => {
    vi.mocked(extractEpub).mockResolvedValue(THIN_META as never);
    vi.stubGlobal("fetch", olFetch([CLEAN_DOC]));

    // Filename signal must actually match the canned doc, else the confidence
    // floor (MIN_SUGGESTION_CONFIDENCE) correctly drops it as noise.
    const at = stage("Clean Code.epub");
    await scanFile(at);

    const book = await h.prisma.book.findFirstOrThrow();
    const rows = await h.prisma.bookSuggestion.findMany({ where: { bookId: book.id } });
    expect(rows.length).toBeGreaterThan(0);

    const top = rows[0];
    expect(top.source).toBe("openlibrary");
    expect(top.status).toBe("pending"); // D-3c: no silent auto-accept
    // string[] (in-memory) → JSON string (column).
    expect(JSON.parse(top.authors)).toContain("Robert C. Martin");
    expect(JSON.parse(top.subjects)).toContain("Software engineering");
    expect(top.isbn).toBe("9780132350884");
    expect(top.workKey).toBe("/works/OL45883W");
  });

  it("NON-thin book → no fetch, no suggestions (D-3a gate)", async () => {
    vi.mocked(extractEpub).mockResolvedValue(FULL_META as never);
    const fetchSpy = olFetch([CLEAN_DOC]);
    vi.stubGlobal("fetch", fetchSpy);

    const at = stage("x.epub");
    await scanFile(at);

    const book = await h.prisma.book.findFirstOrThrow();
    expect(book.title).toBe("Deep Work"); // imported with its real metadata
    expect(fetchSpy).not.toHaveBeenCalled(); // gate short-circuited before enrich
    expect(await h.prisma.bookSuggestion.count()).toBe(0);
  });

  it("enrich network failure → import still succeeds, zero suggestions (best-effort)", async () => {
    vi.mocked(extractEpub).mockResolvedValue(THIN_META as never);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      }),
    );

    const at = stage("book.epub");
    await expect(scanFile(at)).resolves.toBeUndefined(); // never throws

    expect(await h.prisma.book.count()).toBe(1); // import succeeded
    expect(await h.prisma.bookSuggestion.count()).toBe(0); // swallowed
  });

  it("a throwing persistence step never breaks the import (hook try/catch fences the DB write)", async () => {
    vi.mocked(extractEpub).mockResolvedValue(THIN_META as never);
    vi.stubGlobal("fetch", olFetch([CLEAN_DOC]));
    // Force the createMany inside the hook to reject — the hook's own catch must
    // swallow it so the already-created Book survives.
    const spy = vi
      .spyOn(h.prisma.bookSuggestion, "createMany")
      .mockRejectedValueOnce(new Error("boom"));

    // Match the canned doc so a suggestion clears the confidence floor and the
    // hook reaches the (mocked-to-throw) createMany this test is fencing.
    const at = stage("Clean Code.epub");
    await expect(scanFile(at)).resolves.toBeUndefined();

    expect(spy).toHaveBeenCalled();
    expect(await h.prisma.book.count()).toBe(1); // import not rolled back
    expect(await h.prisma.bookSuggestion.count()).toBe(0);
    spy.mockRestore();
  });
});
