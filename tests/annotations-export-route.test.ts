// ANNOTATIONS-EXPORT-01 — GET /api/books/[id]/annotations returns the signed-in
// user's highlights + notes for one book as a portable Markdown attachment,
// session-gated and per-user.
//
// Seam mirrors tests/library-folders.test.ts: a vi.hoisted() ephemeral
// PrismaClient bound to a temp SQLite file (injected via vi.mock("@/lib/prisma")),
// the @/auth seam mocked so the real getCurrentUser logic runs against a fake
// session, committed migrations applied to the throwaway file in beforeAll.
//
// Branches exercised (branch-coverage rule — every branch the route introduces):
//   - 401 signed-out: no session short-circuits before any query
//   - 404 unknown book: findUnique returns null
//   - 200 happy path: a book with this user's highlights + notes → Markdown doc
//     with Content-Type text/markdown + Content-Disposition attachment
//   - per-user isolation: another user's highlights/notes on the same book never
//     appear in the requesting user's export
//   - empty-annotations 200: a book with no annotations still returns 200 with a
//     header-only Markdown document (no highlights/notes sections crashing)

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
  const dir = mkdtempSync(path.join(tmpdir(), "hlr-annexport-"));
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
import { GET } from "@/app/api/books/[id]/annotations/route";

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

async function makeBook() {
  return h.prisma.book.create({
    data: {
      filePath: "/books/python/think.epub",
      format: "epub",
      title: "Think Python",
      isbn: "9781449330729",
      authors: { create: [{ name: "Allen B. Downey" }] },
    },
  });
}

describe("GET /api/books/[id]/annotations", () => {
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

  it("200s the happy path with the user's highlights + notes as a Markdown attachment", async () => {
    await makeUser("u-reader");
    const book = await makeBook();
    await h.prisma.highlight.create({
      data: {
        bookId: book.id,
        userId: "u-reader",
        text: "Programming is fun.",
        anchor: JSON.stringify({ type: "epub-cfi-range", cfiStart: "/6/2", cfiEnd: "/6/4" }),
      },
    });
    await h.prisma.note.create({
      data: {
        bookId: book.id,
        userId: "u-reader",
        body: "Remember this chapter.",
        anchor: JSON.stringify({ type: "epub-cfi", cfi: "/6/2" }),
      },
    });

    asReader("u-reader");
    const res = await GET(new Request("http://test"), ctx(book.id));
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/markdown; charset=utf-8");
    expect(res.headers.get("Content-Disposition")).toBe(
      'attachment; filename="Think-Python-annotations.md"',
    );
    const body = await res.text();
    expect(body).toContain("Think Python");
    expect(body).toContain("Programming is fun.");
    expect(body).toContain("Remember this chapter.");
  });

  it("isolates per user — another user's annotations never appear", async () => {
    await makeUser("u-reader");
    await makeUser("u-other");
    const book = await makeBook();
    await h.prisma.highlight.create({
      data: {
        bookId: book.id,
        userId: "u-other",
        text: "OTHER USER SECRET HIGHLIGHT",
        anchor: JSON.stringify({ type: "epub-cfi-range", cfiStart: "/6/2", cfiEnd: "/6/4" }),
      },
    });
    await h.prisma.note.create({
      data: {
        bookId: book.id,
        userId: "u-other",
        body: "OTHER USER SECRET NOTE",
        anchor: JSON.stringify({ type: "epub-cfi", cfi: "/6/2" }),
      },
    });

    asReader("u-reader");
    const res = await GET(new Request("http://test"), ctx(book.id));
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).not.toContain("OTHER USER SECRET HIGHLIGHT");
    expect(body).not.toContain("OTHER USER SECRET NOTE");
  });

  it("200s a book with no annotations — header-only document", async () => {
    await makeUser("u-reader");
    const book = await makeBook();

    asReader("u-reader");
    const res = await GET(new Request("http://test"), ctx(book.id));
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/markdown; charset=utf-8");
    const body = await res.text();
    // The book title still appears (header) even with zero annotations.
    expect(body).toContain("Think Python");
  });
});
