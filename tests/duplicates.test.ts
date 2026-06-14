// Slice 1 — groupDuplicates helper + GET /api/books/duplicates.
//
// The pure helper is tested directly (every branch of the D-C1..D-C5
// decisions). The route is tested through the same ephemeral-DB seam as
// tests/library-folders.test.ts: a vi.hoisted() PrismaClient bound to a temp
// SQLite file, injected via vi.mock("@/lib/prisma"); the @/auth seam mocked so
// the real getCurrentUser logic runs against a fake session; migrations applied
// to the throwaway file in beforeAll. The happy path genuinely queries Prisma
// (groups derived from seeded Book rows); the unauthenticated case
// short-circuits with 401 before any query.

import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  vi,
} from "vitest";
import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";

import { groupDuplicates, type DupBook } from "@/lib/library/duplicates";

// --- hoisted: build the temp DB url + client before any module import -------
const h = await vi.hoisted(async () => {
  const { mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const path = (await import("node:path")).default;
  const { PrismaClient } = await import("@prisma/client");
  const dir = mkdtempSync(path.join(tmpdir(), "hlr-dupes-"));
  const dbFile = path.join(dir, "test.db");
  const url = `file:${dbFile}`;
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  return { dir, url, prisma };
});

// Inject the ephemeral client wherever the route imports prisma.
vi.mock("@/lib/prisma", () => ({ prisma: h.prisma }));
// Mock the auth seam; the real getCurrentUser logic runs against the fake session.
vi.mock("@/auth", () => ({ auth: vi.fn() }));

import { asReader, signOut } from "./helpers/auth-mock";
import { GET } from "@/app/api/books/duplicates/route";

// Small builder so each test reads as data, not boilerplate.
function book(p: Partial<DupBook> & { id: string; title: string }): DupBook {
  return {
    format: "epub",
    isbn: null,
    authors: [],
    coverUrl: null,
    ...p,
  };
}

describe("groupDuplicates (pure)", () => {
  it("groups two books with the same normalized ISBN (one hyphenated)", () => {
    const groups = groupDuplicates([
      book({ id: "a", title: "Clean Code", isbn: "978-0-13-468599-1" }),
      book({ id: "b", title: "clean code (copy)", isbn: "9780134685991" }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].reason).toBe("isbn");
    expect(groups[0].books.map((x) => x.id).sort()).toEqual(["a", "b"]);
  });

  it("groups different-ISBN books that share a normalized title+author", () => {
    const groups = groupDuplicates([
      book({ id: "a", title: "The Pragmatic Programmer", authors: ["Andy Hunt"], isbn: null }),
      book({ id: "b", title: "the  pragmatic programmer!", authors: ["Andy Hunt"], isbn: null }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].reason).toBe("title-author");
    expect(groups[0].books.map((x) => x.id).sort()).toEqual(["a", "b"]);
  });

  it("a book WITH an isbn never joins a title+author group (D-C3)", () => {
    // Same title+author, but one carries an ISBN that has no partner: it must
    // not pull into the title+author bucket. Result is at most one group, of
    // the two ISBN-less matches only.
    const groups = groupDuplicates([
      book({ id: "withIsbn", title: "Refactoring", authors: ["Martin Fowler"], isbn: "9780201485677" }),
      book({ id: "x", title: "Refactoring", authors: ["Martin Fowler"], isbn: null }),
      book({ id: "y", title: "refactoring", authors: ["martin fowler"], isbn: null }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].reason).toBe("title-author");
    expect(groups[0].books.map((x) => x.id).sort()).toEqual(["x", "y"]);
    // The ISBN-carrying book is in no group.
    expect(
      groups.some((g) => g.books.some((b) => b.id === "withIsbn")),
    ).toBe(false);
  });

  it("returns no group for a unique book (D-C4)", () => {
    expect(
      groupDuplicates([book({ id: "lone", title: "One Of A Kind" })]),
    ).toEqual([]);
  });

  it("groups epub+pdf with the same isbn and keeps each member's format (D-C5)", () => {
    const groups = groupDuplicates([
      book({ id: "e", title: "DDIA", format: "epub", isbn: "9781449373320" }),
      book({ id: "p", title: "DDIA", format: "pdf", isbn: "9781449373320" }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].reason).toBe("isbn");
    const byId = Object.fromEntries(groups[0].books.map((b) => [b.id, b.format]));
    expect(byId).toEqual({ e: "epub", p: "pdf" });
  });

  it("returns [] for empty input", () => {
    expect(groupDuplicates([])).toEqual([]);
  });
});

describe("GET /api/books/duplicates", () => {
  beforeAll(() => {
    // Apply committed migrations to the throwaway file (schema can't drift).
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
    signOut();
    await h.prisma.book.deleteMany();
    await h.prisma.author.deleteMany();
  });

  it("returns duplicate groups derived from seeded rows (200)", async () => {
    const fowler = await h.prisma.author.create({ data: { name: "Martin Fowler" } });
    // Two ISBN-less rows that share title+author -> one group.
    await h.prisma.book.create({
      data: {
        filePath: "/books/refactoring.epub",
        format: "epub",
        title: "Refactoring",
        authors: { connect: { id: fowler.id } },
      },
    });
    await h.prisma.book.create({
      data: {
        filePath: "/books/refactoring-2.pdf",
        format: "pdf",
        title: "Refactoring",
        authors: { connect: { id: fowler.id } },
      },
    });
    // A lone book that must not appear.
    await h.prisma.book.create({
      data: { filePath: "/books/solo.epub", format: "epub", title: "Solo Work" },
    });

    asReader("u-reader");
    const res = await GET();
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.groups).toHaveLength(1);
    expect(body.groups[0].reason).toBe("title-author");
    expect(body.groups[0].books).toHaveLength(2);
    // parity with library-folders: no scan-root string leaks into the payload
    expect(JSON.stringify(body)).not.toContain("/books");
  });

  it("401s an unauthenticated request", async () => {
    signOut();
    const res = await GET();
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthenticated" });
  });
});
