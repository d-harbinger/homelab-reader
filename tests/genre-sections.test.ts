// GENRE-01 — the pure groupByGenre helper + GET /api/genres/sections.
//
// Two layers under test:
//   1. groupByGenre(books, roots, opts) — pure, no DB/fs. Buckets books by the
//      TOP-LEVEL on-disk folder (relativeFolder(...).split("/")[0]), drops
//      buckets below minBooks, sorts buckets alphabetically, truncates each to
//      maxPerSection, and — crucially — never forwards filePath into the
//      section payload (path-private; the caller maps to a card shape).
//   2. GET /api/genres/sections — the thin Prisma+privacy wrapper. Seam mirrors
//      tests/library-folders.test.ts exactly: a vi.hoisted() ephemeral
//      PrismaClient bound to a temp SQLite file (injected via
//      vi.mock("@/lib/prisma")), the @/auth seam mocked so the real
//      getCurrentUser logic runs against a fake session, migrations applied to
//      the throwaway file in beforeAll. Happy path genuinely queries Prisma; the
//      unauthenticated case short-circuits before any query.

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

import { groupByGenre } from "@/lib/library/genre-sections";

// --- hoisted: build the temp DB url + client before any module import -------
const h = await vi.hoisted(async () => {
  const { mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const path = (await import("node:path")).default;
  const { PrismaClient } = await import("@prisma/client");
  const dir = mkdtempSync(path.join(tmpdir(), "hlr-genres-"));
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
import { GET } from "@/app/api/genres/sections/route";

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
  await h.prisma.scanLocation.deleteMany();
});

// ---------------------------------------------------------------------------
// Layer 1 — pure helper
// ---------------------------------------------------------------------------
describe("groupByGenre (pure helper)", () => {
  const roots = ["/books"];
  const opts = { minBooks: 3, maxPerSection: 18 };

  // Build a book with a sequential addedAt so "input order = recent-first" is
  // explicit and verifiable in tests that care about ordering.
  function bk(id: string, filePath: string) {
    return { id, filePath };
  }

  it("groups books by their top-level folder (nested subfolders roll up)", () => {
    const books = [
      bk("a", "/books/python/web/a.epub"),
      bk("b", "/books/python/b.epub"),
      bk("c", "/books/python/cli/c.epub"),
    ];
    const sections = groupByGenre(books, roots, opts);
    expect(sections).toHaveLength(1);
    expect(sections[0].genre).toBe("python");
    expect(sections[0].books.map((x) => x.id)).toEqual(["a", "b", "c"]);
  });

  it("drops a folder with fewer than minBooks books (no section)", () => {
    const books = [
      bk("a", "/books/python/a.epub"),
      bk("b", "/books/python/b.epub"), // only 2 < minBooks(3)
      bk("c", "/books/ai/c.epub"),
      bk("d", "/books/ai/d.epub"),
      bk("e", "/books/ai/e.epub"), // 3 >= minBooks
    ];
    const sections = groupByGenre(books, roots, opts);
    expect(sections.map((s) => s.genre)).toEqual(["ai"]);
  });

  it("excludes books sitting directly under a scan root (no folder)", () => {
    const books = [
      bk("root1", "/books/loose1.epub"),
      bk("root2", "/books/loose2.epub"),
      bk("root3", "/books/loose3.epub"),
      bk("p1", "/books/python/a.epub"),
      bk("p2", "/books/python/b.epub"),
      bk("p3", "/books/python/c.epub"),
    ];
    const sections = groupByGenre(books, roots, opts);
    // The 3 loose books map to genre "" and must NOT form a section.
    expect(sections.map((s) => s.genre)).toEqual(["python"]);
    expect(sections[0].books.map((b) => b.id)).toEqual(["p1", "p2", "p3"]);
  });

  it("excludes books under no scan root (relativeFolder returns null)", () => {
    const books = [
      bk("x1", "/elsewhere/python/a.epub"),
      bk("x2", "/elsewhere/python/b.epub"),
      bk("x3", "/elsewhere/python/c.epub"),
      bk("p1", "/books/ai/a.epub"),
      bk("p2", "/books/ai/b.epub"),
      bk("p3", "/books/ai/c.epub"),
    ];
    const sections = groupByGenre(books, roots, opts);
    expect(sections.map((s) => s.genre)).toEqual(["ai"]);
  });

  it("orders rows alphabetically by genre", () => {
    const books = [
      bk("z1", "/books/zebra/a.epub"),
      bk("z2", "/books/zebra/b.epub"),
      bk("z3", "/books/zebra/c.epub"),
      bk("a1", "/books/ai/a.epub"),
      bk("a2", "/books/ai/b.epub"),
      bk("a3", "/books/ai/c.epub"),
      bk("m1", "/books/middle/a.epub"),
      bk("m2", "/books/middle/b.epub"),
      bk("m3", "/books/middle/c.epub"),
    ];
    const sections = groupByGenre(books, roots, opts);
    expect(sections.map((s) => s.genre)).toEqual(["ai", "middle", "zebra"]);
  });

  it("preserves input order (recent-first) within a row and caps at maxPerSection", () => {
    // Caller hands an addedAt-desc list; the helper must NOT reorder within a
    // bucket, and must truncate to maxPerSection.
    const books = Array.from({ length: 5 }, (_, i) =>
      bk(`p${i}`, `/books/python/${i}.epub`),
    );
    const sections = groupByGenre(books, roots, {
      minBooks: 3,
      maxPerSection: 3,
    });
    expect(sections).toHaveLength(1);
    // first 3 in input order, tail dropped
    expect(sections[0].books.map((b) => b.id)).toEqual(["p0", "p1", "p2"]);
  });

  it("never forwards filePath into the section payload (path-private)", () => {
    const books = [
      bk("p1", "/books/python/a.epub"),
      bk("p2", "/books/python/b.epub"),
      bk("p3", "/books/python/c.epub"),
    ];
    const sections = groupByGenre(books, roots, opts);
    // The helper returns the SAME element references it was given (it only
    // buckets); path-stripping is the route's job. But the helper itself must
    // not invent a payload carrying the path under a different key, and the
    // genre string must be the folder name, never the absolute path.
    expect(JSON.stringify(sections.map((s) => s.genre))).not.toContain("/books");
  });
});

// ---------------------------------------------------------------------------
// Layer 2 — route
// ---------------------------------------------------------------------------
describe("GET /api/genres/sections", () => {
  it("200: returns top-level-folder rows derived from seeded books, no path leak", async () => {
    await h.prisma.scanLocation.create({ data: { path: "/books" } });
    // 3 python (qualifies), 3 ai (qualifies), 1 loose (dropped), 2 rust (below
    // threshold, dropped).
    const seed: [string, string][] = [
      ["py-a", "/books/python/web/a.epub"],
      ["py-b", "/books/python/b.epub"],
      ["py-c", "/books/python/cli/c.epub"],
      ["ai-a", "/books/ai/a.epub"],
      ["ai-b", "/books/ai/b.epub"],
      ["ai-c", "/books/ai/c.epub"],
      ["loose", "/books/loose.epub"],
      ["rust-a", "/books/rust/a.epub"],
      ["rust-b", "/books/rust/b.epub"],
    ];
    for (const [id, fp] of seed) {
      await h.prisma.book.create({
        data: { id, filePath: fp, format: "epub", title: id },
      });
    }
    asReader("u-reader");
    const res = await GET();
    const body = await res.json();
    expect(res.status).toBe(200);
    // alphabetical rows, threshold-filtered
    expect(body.sections.map((s: { genre: string }) => s.genre)).toEqual([
      "ai",
      "python",
    ]);
    // each section's books carry the card fields, never filePath
    for (const section of body.sections) {
      for (const b of section.books) {
        expect(b).toHaveProperty("id");
        expect(b).toHaveProperty("title");
        expect(b).not.toHaveProperty("filePath");
      }
    }
    // privacy: no absolute scan-root path anywhere in the payload
    expect(JSON.stringify(body)).not.toContain("/books");
  });

  it("401s an unauthenticated request", async () => {
    signOut();
    const res = await GET();
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthenticated" });
  });
});
