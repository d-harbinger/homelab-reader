// FLASHCARDS-ROUTE-01 — GET /api/books/[id]/flashcards returns the signed-in
// user's highlights as an Anki-importable attachment, tagged by the color key.
// Seam mirrors tests/annotations-export-route.test.ts (ephemeral SQLite +
// mocked @/auth). The renderer itself is covered in flashcard-export.test.ts;
// this exercises the route's own branches.
//
// Branches exercised:
//   - 401 signed out
//   - 404 unknown book
//   - 200 happy path: header directives + a card whose back and tag come from
//     the user's own color key and note
//   - per-user isolation: another user's highlights never appear

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

const h = await vi.hoisted(async () => {
  const { mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const path = (await import("node:path")).default;
  const { PrismaClient } = await import("@prisma/client");
  const dir = mkdtempSync(path.join(tmpdir(), "hlr-flashcards-"));
  const dbFile = path.join(dir, "test.db");
  const url = `file:${dbFile}`;
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  return { dir, url, prisma };
});

vi.mock("@/lib/prisma", () => ({ prisma: h.prisma }));
vi.mock("@/auth", () => ({ auth: vi.fn() }));

import { asReader, signOut } from "./helpers/auth-mock";
import { GET } from "@/app/api/books/[id]/flashcards/route";

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
  signOut();
  await h.prisma.highlightKeyEntry.deleteMany();
  await h.prisma.highlight.deleteMany();
  await h.prisma.note.deleteMany();
  await h.prisma.book.deleteMany();
  await h.prisma.user.deleteMany();
});

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
    },
  });
}

describe("GET /api/books/[id]/flashcards", () => {
  it("401s an unauthenticated request", async () => {
    const res = await GET(new Request("http://test"), ctx("any-id"));
    expect(res.status).toBe(401);
  });

  it("404s an unknown book", async () => {
    await makeUser("u1");
    asReader("u1");
    const res = await GET(new Request("http://test"), ctx("no-such-book"));
    expect(res.status).toBe(404);
  });

  it("200s an Anki-importable attachment tagged by the user's color key", async () => {
    await makeUser("u1");
    const book = await makeBook();
    const hl = await h.prisma.highlight.create({
      data: {
        bookId: book.id,
        userId: "u1",
        text: "Encapsulation",
        color: "yellow",
        anchor: JSON.stringify({ type: "pdf-rect", page: 4, rects: [] }),
      },
    });
    await h.prisma.note.create({
      data: {
        bookId: book.id,
        userId: "u1",
        body: "Bundling data with the methods that operate on it.",
        anchor: JSON.stringify({ type: "pdf-point", page: 4 }),
        highlightId: hl.id,
      },
    });
    await h.prisma.highlightKeyEntry.create({
      data: { bookId: book.id, userId: "u1", color: "yellow", label: "Key terms" },
    });

    asReader("u1");
    const res = await GET(new Request("http://test"), ctx(book.id));
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/plain; charset=utf-8");
    expect(res.headers.get("Content-Disposition")).toBe(
      'attachment; filename="Think-Python-flashcards.txt"',
    );
    const body = await res.text();
    expect(body).toContain("#separator:tab");
    expect(body).toContain(
      "Encapsulation\tBundling data with the methods that operate on it.\tthink-python key-terms",
    );
  });

  it("isolates per user — another user's highlights never appear", async () => {
    await makeUser("u1");
    await makeUser("u2");
    const book = await makeBook();
    await h.prisma.highlight.create({
      data: {
        bookId: book.id,
        userId: "u2",
        text: "OTHER USER SECRET",
        anchor: JSON.stringify({ type: "pdf-rect", page: 1, rects: [] }),
      },
    });

    asReader("u1");
    const res = await GET(new Request("http://test"), ctx(book.id));
    const body = await res.text();
    expect(body).not.toContain("OTHER USER SECRET");
  });
});
