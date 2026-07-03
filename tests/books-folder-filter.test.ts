// BOOKS-FOLDER-FILTER — GET /api/books gains an optional `folder` query param
// that filters the flat list to books whose root-relative folder starts with
// the requested path. The filtering happens entirely server-side: the route
// strips each book's scan root (via the same longest-root logic the folder
// tree uses) and compares the relative folder, so absolute filesystem paths
// never enter the response. The response shape is unchanged either way.
//
// Seam mirrors tests/library-folders.test.ts: a vi.hoisted() ephemeral
// PrismaClient bound to a temp SQLite file (injected via vi.mock("@/lib/prisma")),
// migrations applied to the throwaway file in beforeAll. These cases all query
// Prisma for real — the param is exercised against real Book + ScanLocation rows.
//
// Branches enumerated:
//   - no `folder` param        → response unchanged (every book returned)
//   - folder matches a subset  → only books under that folder
//   - folder matches nothing   → 200 with an empty list (not an error)
//   - nested subpath (e.g. "python/web") → only the deeper subtree

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
  const dir = mkdtempSync(path.join(tmpdir(), "hlr-books-folder-"));
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
  // Author.name is @unique — delete authors between user/book teardown so the
  // fixture can recreate the same author rows without tripping the constraint.
  await h.prisma.book.deleteMany();
  await h.prisma.author.deleteMany();
  await h.prisma.scanLocation.deleteMany();
});

// Seed one scan root and four books across python/, python/web/, and ai/.
async function seed() {
  await h.prisma.scanLocation.create({ data: { path: "/books" } });
  // Titles are deliberately distinct from the on-disk paths so the privacy
  // assertion (no "/books" in the response) genuinely tests the route, not the
  // fixture: a leaked absolute path could only come from the filtering logic.
  const files: [string, string][] = [
    ["/books/python/a.epub", "A"],
    ["/books/python/web/b.epub", "B"],
    ["/books/python/web/c.epub", "C"],
    ["/books/ai/d.epub", "D"],
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

describe("GET /api/books?folder=", () => {
  it("no folder param → response unchanged (all books)", async () => {
    await seed();
    const res = await GET(req());
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.books).toHaveLength(4);
    // privacy: absolute scan-root path never appears in the response
    expect(JSON.stringify(body)).not.toContain("/books");
  });

  it("folder matches a subset → only books under that folder", async () => {
    await seed();
    const res = await GET(req("?folder=python"));
    const body = await res.json();
    expect(res.status).toBe(200);
    // python/a.epub + python/web/{b,c}.epub — the whole python subtree, ai excluded
    expect(body.books).toHaveLength(3);
    expect(JSON.stringify(body)).not.toContain("/books");
  });

  it("folder matches nothing → 200 with an empty list", async () => {
    await seed();
    const res = await GET(req("?folder=nonexistent"));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.books).toEqual([]);
  });

  it("nested subpath → only the deeper subtree", async () => {
    await seed();
    const res = await GET(req("?folder=python/web"));
    const body = await res.json();
    expect(res.status).toBe(200);
    // only python/web/{b,c}.epub — python/a.epub excluded
    expect(body.books).toHaveLength(2);
    expect(JSON.stringify(body)).not.toContain("/books");
  });

  // REGRESSION (DEFECT: folder filter blind to books beyond the 200-row cap):
  // the matched book must survive the row cap. Seed one book in the target
  // folder, then >200 OTHER books with NEWER addedAt timestamps so the target
  // book sits outside a recent-first 200-row fetch window. The folder filter
  // must still return it — proving the match happens in SQL, before the cap.
  // The 251 sequential inserts routinely exceed the default 5s timeout when
  // the full suite runs in parallel workers, so this test carries its own.
  it("returns a folder book buried beyond the 200-row recency cap", { timeout: 30_000 }, async () => {
    await h.prisma.scanLocation.create({ data: { path: "/books" } });
    const base = new Date("2020-01-01T00:00:00Z").getTime();
    // The target book is the OLDEST (earliest addedAt) — last in recency order.
    await h.prisma.book.create({
      data: {
        filePath: "/books/python/web/target.epub",
        format: "epub",
        title: "TARGET",
        addedAt: new Date(base),
      },
    });
    // 250 newer books OUTSIDE the folder — they fill (and overflow) the cap.
    for (let i = 0; i < 250; i++) {
      await h.prisma.book.create({
        data: {
          filePath: `/books/ai/filler-${i}.epub`,
          format: "epub",
          title: `FILLER ${i}`,
          addedAt: new Date(base + (i + 1) * 1000),
        },
      });
    }
    const res = await GET(req("?folder=python/web"));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.books).toHaveLength(1);
    expect(body.books[0].title).toBe("TARGET");
    expect(JSON.stringify(body)).not.toContain("/books");
  });

  // PREFIX EDGE: a startsWith match on the bare folder name would wrongly pull
  // "python/webinar/" into "?folder=python/web". The trailing-slash prefix
  // (`<root>/python/web/`) must exclude it.
  it("does not match a sibling folder sharing a name prefix", async () => {
    await h.prisma.scanLocation.create({ data: { path: "/books" } });
    await h.prisma.book.create({
      data: { filePath: "/books/python/web/in.epub", format: "epub", title: "IN" },
    });
    await h.prisma.book.create({
      data: {
        filePath: "/books/python/webinar/out.epub",
        format: "epub",
        title: "OUT",
      },
    });
    const res = await GET(req("?folder=python/web"));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.books).toHaveLength(1);
    expect(body.books[0].title).toBe("IN");
  });
});
