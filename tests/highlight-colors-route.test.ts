// HIGHLIGHT-COLORS-01 — /api/books/highlight-colors: the per-book, per-color
// counts that drive the library's "filter by highlight color" bar. Same seam as
// tests/color-key-route.test.ts: ephemeral PrismaClient on a temp SQLite file,
// mocked @/auth seam, committed migrations applied in beforeAll.
//
// Branches exercised:
//   GET — 401 signed out · 200 empty when the reader has no highlights ·
//         groups by book AND color with counts · per-user isolation

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
  const dir = mkdtempSync(path.join(tmpdir(), "hlr-hlcolors-"));
  const dbFile = path.join(dir, "test.db");
  const url = `file:${dbFile}`;
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  return { dir, url, prisma };
});

vi.mock("@/lib/prisma", () => ({ prisma: h.prisma }));
vi.mock("@/auth", () => ({ auth: vi.fn() }));

import { asReader, signOut } from "./helpers/auth-mock";
import { GET } from "@/app/api/books/highlight-colors/route";

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
  await h.prisma.highlight.deleteMany();
  await h.prisma.book.deleteMany();
  await h.prisma.user.deleteMany();
});

async function makeUser(id: string) {
  return h.prisma.user.create({
    data: { id, username: `user-${id}`, passwordHash: "x", role: "reader" },
  });
}

let bookSeq = 0;
async function makeBook() {
  bookSeq += 1;
  return h.prisma.book.create({
    data: {
      filePath: `/books/python/think-${bookSeq}.epub`,
      format: "epub",
      title: `Think Python ${bookSeq}`,
    },
  });
}

async function highlight(bookId: string, userId: string, color: string) {
  return h.prisma.highlight.create({
    data: { bookId, userId, color, text: "x", anchor: "{}" },
  });
}

function getReq() {
  return new Request("http://test/api/books/highlight-colors");
}

describe("GET /api/books/highlight-colors", () => {
  it("401s an unauthenticated request", async () => {
    const res = await GET(getReq());
    expect(res.status).toBe(401);
  });

  it("200s an empty map when the reader has no highlights", async () => {
    await makeUser("u1");
    asReader("u1");
    const res = await GET(getReq());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ byBook: {} });
  });

  it("groups by book AND color with counts", async () => {
    await makeUser("u1");
    const a = await makeBook();
    const b = await makeBook();
    await highlight(a.id, "u1", "green");
    await highlight(a.id, "u1", "green");
    await highlight(a.id, "u1", "yellow");
    await highlight(b.id, "u1", "blue");
    asReader("u1");

    const res = await GET(getReq());
    const { byBook } = (await res.json()) as {
      byBook: Record<string, Record<string, number>>;
    };
    expect(byBook[a.id]).toEqual({ green: 2, yellow: 1 });
    expect(byBook[b.id]).toEqual({ blue: 1 });
  });

  it("only counts the signed-in reader's highlights", async () => {
    await makeUser("u1");
    await makeUser("u2");
    const book = await makeBook();
    await highlight(book.id, "u1", "green");
    await highlight(book.id, "u2", "red");
    asReader("u1");

    const res = await GET(getReq());
    const { byBook } = (await res.json()) as {
      byBook: Record<string, Record<string, number>>;
    };
    // u2's red highlight on the same book must not leak into u1's view.
    expect(byBook[book.id]).toEqual({ green: 1 });
  });
});
