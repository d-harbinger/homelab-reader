// CITATION-ROUTE-01 — GET /api/books/[id]/citation returns a JSON
// { reference, bibtex } pair for one book, session-gated. The route maps the
// Book row onto CitationInput (publishedYear from publishedAt.getFullYear(),
// authors from the relation rows' names, publisher/isbn null→undefined) and
// renders via formatReference / formatBibtex.
//
// Seam mirrors tests/annotations-export-route.test.ts and
// tests/library-folders.test.ts: a vi.hoisted() ephemeral PrismaClient bound to
// a temp SQLite file (injected via vi.mock("@/lib/prisma")), the @/auth seam
// mocked so the real getCurrentUser logic runs against a fake session, committed
// migrations applied to the throwaway file in beforeAll.
//
// Branches exercised (branch-coverage rule — every branch the route introduces):
//   - 401 signed-out: no session short-circuits before any query
//   - 404 unknown book: findUnique returns null
//   - 200 full metadata: title + authors + publishedAt + publisher + isbn → the
//     reference + bibtex carry every field
//   - 200 sparse metadata: no publisher, no publishedAt, no isbn → the formatter
//     omits those fields (the bibtex never emits blank publisher/year/isbn keys)

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
  const dir = mkdtempSync(path.join(tmpdir(), "hlr-citation-"));
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
import { GET } from "@/app/api/books/[id]/citation/route";

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
  // Order matters for FK cascade cleanliness; deleteMany on leaf tables first.
  await h.prisma.highlight.deleteMany();
  await h.prisma.note.deleteMany();
  await h.prisma.book.deleteMany();
  // Author.name is @unique and the book↔author relation is implicit M:N, so
  // deleting books leaves orphaned Author rows that would collide on re-seed.
  await h.prisma.author.deleteMany();
  await h.prisma.user.deleteMany();
});

// Helper: params is a Promise<{ id }> in Next 15 route handlers.
function ctx(id: string) {
  return { params: Promise.resolve({ id }) };
}

async function makeUser(id: string) {
  return h.prisma.user.create({
    data: { id, username: `user-${id}`, passwordHash: "x", role: "reader" },
  });
}

async function makeFullBook() {
  return h.prisma.book.create({
    data: {
      filePath: "/books/python/think.epub",
      format: "epub",
      title: "Think Python",
      isbn: "9781449330729",
      publisher: "O'Reilly Media",
      publishedAt: new Date("2012-08-15T00:00:00.000Z"),
      authors: { create: [{ name: "Allen B. Downey" }] },
    },
  });
}

async function makeSparseBook() {
  return h.prisma.book.create({
    data: {
      filePath: "/books/misc/untitled.epub",
      format: "epub",
      title: "Lonesome Title",
      // no isbn, no publisher, no publishedAt
      authors: { create: [{ name: "Jane Roe" }] },
    },
  });
}

describe("GET /api/books/[id]/citation", () => {
  it("401s an unauthenticated request", async () => {
    signOut();
    const res = await GET(new Request("http://test"), ctx("any-id"));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthenticated" });
  });

  it("404s an unknown book", async () => {
    await makeUser("u-reader");
    asReader("u-reader");
    const res = await GET(new Request("http://test"), ctx("no-such-book"));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Not found" });
  });

  it("200s full metadata — reference + bibtex carry every field", async () => {
    await makeUser("u-reader");
    const book = await makeFullBook();

    asReader("u-reader");
    const res = await GET(new Request("http://test"), ctx(book.id));
    expect(res.status).toBe(200);
    const json = (await res.json()) as { reference: string; bibtex: string };

    // reference: author — _title_ (publisher, year). ISBN ...
    expect(json.reference).toContain("Allen B. Downey");
    expect(json.reference).toContain("_Think Python_");
    expect(json.reference).toContain("O'Reilly Media");
    expect(json.reference).toContain("2012");
    expect(json.reference).toContain("ISBN 9781449330729");

    // bibtex: every field present as a key
    expect(json.bibtex).toContain("@book{");
    expect(json.bibtex).toContain("author = {Allen B. Downey}");
    expect(json.bibtex).toContain("title = {Think Python}");
    expect(json.bibtex).toContain("publisher = {O'Reilly Media}");
    expect(json.bibtex).toContain("year = {2012}");
    expect(json.bibtex).toContain("isbn = {9781449330729}");
  });

  it("200s sparse metadata — formatter omits publisher/year/isbn, never blanks", async () => {
    await makeUser("u-reader");
    const book = await makeSparseBook();

    asReader("u-reader");
    const res = await GET(new Request("http://test"), ctx(book.id));
    expect(res.status).toBe(200);
    const json = (await res.json()) as { reference: string; bibtex: string };

    // The present fields still render.
    expect(json.reference).toContain("Jane Roe");
    expect(json.reference).toContain("_Lonesome Title_");
    expect(json.bibtex).toContain("author = {Jane Roe}");
    expect(json.bibtex).toContain("title = {Lonesome Title}");

    // The absent fields are omitted as keys, not emitted blank.
    expect(json.bibtex).not.toContain("publisher =");
    expect(json.bibtex).not.toContain("year =");
    expect(json.bibtex).not.toContain("isbn =");
    // And the reference has no parenthetical (publisher/year) nor ISBN tail.
    expect(json.reference).not.toContain("(");
    expect(json.reference).not.toContain("ISBN");
  });
});
