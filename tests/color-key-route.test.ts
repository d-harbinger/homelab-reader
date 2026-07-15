// COLOR-KEY-01 — /api/highlight-key: the per-book, per-user highlight color
// key (color → meaning). Seam mirrors tests/annotations-export-route.test.ts:
// ephemeral PrismaClient on a temp SQLite file, mocked @/auth seam, committed
// migrations applied in beforeAll.
//
// Branches exercised:
//   GET  — 401 signed out · 400 missing bookId · 200 map (only labeled colors)
//   PUT  — 401 signed out · 400 missing fields · 400 invalid color ·
//          400 non-string label · 404 unknown book · upsert (create + update) ·
//          empty label clears the entry (idempotent) · label bounded to 60 ·
//          per-user isolation (two users, same book, different keys)

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
  const dir = mkdtempSync(path.join(tmpdir(), "hlr-colorkey-"));
  const dbFile = path.join(dir, "test.db");
  const url = `file:${dbFile}`;
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  return { dir, url, prisma };
});

vi.mock("@/lib/prisma", () => ({ prisma: h.prisma }));
vi.mock("@/auth", () => ({ auth: vi.fn() }));

import { asReader, signOut } from "./helpers/auth-mock";
import { GET, PUT } from "@/app/api/highlight-key/route";

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
  await h.prisma.book.deleteMany();
  await h.prisma.user.deleteMany();
});

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

function getReq(bookId?: string) {
  const qs = bookId ? `?bookId=${encodeURIComponent(bookId)}` : "";
  return new Request(`http://test/api/highlight-key${qs}`);
}

function putReq(body: unknown) {
  return new Request("http://test/api/highlight-key", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("GET /api/highlight-key", () => {
  it("401s an unauthenticated request", async () => {
    const res = await GET(getReq("b1"));
    expect(res.status).toBe(401);
  });

  it("400s without a bookId", async () => {
    await makeUser("u1");
    asReader("u1");
    const res = await GET(getReq());
    expect(res.status).toBe(400);
  });

  it("200s the labeled colors as a map", async () => {
    await makeUser("u1");
    const book = await makeBook();
    await h.prisma.highlightKeyEntry.create({
      data: { bookId: book.id, userId: "u1", color: "yellow", label: "Key terms" },
    });
    asReader("u1");
    const res = await GET(getReq(book.id));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ key: { yellow: "Key terms" } });
  });
});

describe("PUT /api/highlight-key", () => {
  it("401s an unauthenticated request", async () => {
    const res = await PUT(putReq({ bookId: "b", color: "yellow", label: "x" }));
    expect(res.status).toBe(401);
  });

  it("400s on missing fields, an unknown color, and a non-string label", async () => {
    await makeUser("u1");
    const book = await makeBook();
    asReader("u1");
    expect((await PUT(putReq({ color: "yellow" }))).status).toBe(400);
    expect((await PUT(putReq({ bookId: book.id }))).status).toBe(400);
    expect(
      (await PUT(putReq({ bookId: book.id, color: "mauve", label: "x" }))).status,
    ).toBe(400);
    expect(
      (await PUT(putReq({ bookId: book.id, color: "yellow", label: 7 }))).status,
    ).toBe(400);
  });

  it("404s an unknown book", async () => {
    await makeUser("u1");
    asReader("u1");
    const res = await PUT(
      putReq({ bookId: "no-such-book", color: "yellow", label: "x" }),
    );
    expect(res.status).toBe(404);
  });

  it("creates, then updates, one entry per color — and returns the full map", async () => {
    await makeUser("u1");
    const book = await makeBook();
    asReader("u1");

    let res = await PUT(
      putReq({ bookId: book.id, color: "yellow", label: "Key terms" }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ key: { yellow: "Key terms" } });

    res = await PUT(
      putReq({ bookId: book.id, color: "yellow", label: "Definitions" }),
    );
    expect(await res.json()).toEqual({ key: { yellow: "Definitions" } });
    expect(await h.prisma.highlightKeyEntry.count()).toBe(1);
  });

  it("clears an entry on empty label — idempotently", async () => {
    await makeUser("u1");
    const book = await makeBook();
    asReader("u1");
    await PUT(putReq({ bookId: book.id, color: "blue", label: "Organizations" }));

    let res = await PUT(putReq({ bookId: book.id, color: "blue", label: "  " }));
    expect(await res.json()).toEqual({ key: {} });
    // Clearing a color that has no entry is a no-op, not an error.
    res = await PUT(putReq({ bookId: book.id, color: "blue", label: "" }));
    expect(res.status).toBe(200);
  });

  it("bounds the stored label to 60 characters", async () => {
    await makeUser("u1");
    const book = await makeBook();
    asReader("u1");
    const res = await PUT(
      putReq({ bookId: book.id, color: "pink", label: "x".repeat(200) }),
    );
    const { key } = (await res.json()) as { key: { pink: string } };
    expect(key.pink).toHaveLength(60);
  });

  it("isolates keys per user on the same book", async () => {
    await makeUser("u1");
    await makeUser("u2");
    const book = await makeBook();

    asReader("u1");
    await PUT(putReq({ bookId: book.id, color: "yellow", label: "Key terms" }));

    asReader("u2");
    await PUT(putReq({ bookId: book.id, color: "yellow", label: "Vocab" }));
    const res = await GET(getReq(book.id));
    expect(await res.json()).toEqual({ key: { yellow: "Vocab" } });

    asReader("u1");
    const res1 = await GET(getReq(book.id));
    expect(await res1.json()).toEqual({ key: { yellow: "Key terms" } });
  });
});
