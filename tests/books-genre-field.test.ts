// BOOKS-GENRE-FIELD — GET /api/books gains a server-derived `genre` on each
// book in the response: the TOP-LEVEL on-disk folder the book sits under
// (python/web → "python"), or null for a book directly under a scan root.
// The genre is derived server-side from filePath via relativeFolder(); the
// absolute path itself never enters the response (same privacy invariant the
// folder-filter already holds).
//
// Seam mirrors tests/books-folder-filter.test.ts: a vi.hoisted() ephemeral
// PrismaClient bound to a temp SQLite file (injected via vi.mock("@/lib/prisma")),
// migrations applied to the throwaway file in beforeAll. The route is
// unauthenticated (no withUser wrapper), so no auth mock is needed.
//
// Branches:
//   - a book under a nested folder (python/web) carries genre "python"
//   - a book directly under the scan root carries genre null
//   - privacy: the absolute scan-root path never appears in the response

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

// --- hoisted: build the temp DB url + client before any module import -------
const h = await vi.hoisted(async () => {
  const { mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const path = (await import("node:path")).default;
  const { PrismaClient } = await import("@prisma/client");
  const dir = mkdtempSync(path.join(tmpdir(), "hlr-books-genre-"));
  const dbFile = path.join(dir, "test.db");
  const url = `file:${dbFile}`;
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  return { dir, url, prisma };
});

// Inject the ephemeral client wherever the route imports prisma.
vi.mock("@/lib/prisma", () => ({ prisma: h.prisma }));

import { GET } from "@/app/api/books/route";

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
  await h.prisma.book.deleteMany();
  await h.prisma.author.deleteMany();
  await h.prisma.scanLocation.deleteMany();
});

// Seed one scan root, a book nested under python/web, and a book directly
// under the root. Titles are deliberately distinct from the on-disk paths so
// the privacy assertion (no "/books" in the response) genuinely tests the
// route, not the fixture.
async function seed() {
  await h.prisma.scanLocation.create({ data: { path: "/books" } });
  const files: [string, string][] = [
    ["/books/python/web/a.epub", "NESTED"],
    ["/books/loose.epub", "LOOSE"],
  ];
  for (const [filePath, title] of files) {
    await h.prisma.book.create({
      data: { filePath, format: "epub", title },
    });
  }
}

function req(query = ""): Request {
  return new Request(`http://test/api/books${query}`);
}

describe("GET /api/books — derived genre field", () => {
  it("a nested book carries its top-level folder as genre", async () => {
    await seed();
    const res = await GET(req());
    const body = await res.json();
    expect(res.status).toBe(200);
    const nested = body.books.find(
      (b: { title: string }) => b.title === "NESTED",
    );
    expect(nested.genre).toBe("python");
  });

  it("a book directly under the scan root carries genre null", async () => {
    await seed();
    const res = await GET(req());
    const body = await res.json();
    expect(res.status).toBe(200);
    const loose = body.books.find(
      (b: { title: string }) => b.title === "LOOSE",
    );
    expect(loose.genre).toBeNull();
  });

  it("does not leak the absolute scan-root path into the response", async () => {
    await seed();
    const res = await GET(req());
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(JSON.stringify(body)).not.toContain("/books");
  });
});
