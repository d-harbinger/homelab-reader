// SUGGESTIONS-ROUTE (D3, Slice 3) — the per-book suggestion review API.
//   GET  /api/books/[id]/suggestions       → pending candidates (ranked)
//   POST /api/books/[id]/suggestions/[sid]  → accept (transactional write-back)
//
// Seam mirrors tests/citation-route.test.ts: a vi.hoisted() ephemeral
// PrismaClient on a temp SQLite file (injected via vi.mock("@/lib/prisma")), the
// @/auth seam mocked so the real getCurrentUser logic runs against a fake
// session, committed migrations applied to the throwaway file in beforeAll.
//
// Branches (branch-coverage rule):
//   GET  — 401 signed-out · 404 unknown book · 200 ranked pending (rejected/
//          accepted excluded)
//   POST — 401 signed-out · 403 non-admin reader (catalog curation is admin-only,
//          it writes the shared Book row) · 404 unknown book · 404 suggestion of
//          another book · 200 accept fills empty fields, does NOT clobber present
//          ones, marks siblings rejected · 200 force overwrites a present field

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
  const dir = mkdtempSync(path.join(tmpdir(), "hlr-suggestions-"));
  const dbFile = path.join(dir, "test.db");
  const url = `file:${dbFile}`;
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  return { dir, url, prisma };
});

vi.mock("@/lib/prisma", () => ({ prisma: h.prisma }));
vi.mock("@/auth", () => ({ auth: vi.fn() }));

import { asReader, asAdmin, signOut } from "./helpers/auth-mock";
import { GET } from "@/app/api/books/[id]/suggestions/route";
import { POST } from "@/app/api/books/[id]/suggestions/[sid]/route";

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
  await h.prisma.bookSuggestion.deleteMany();
  await h.prisma.book.deleteMany();
  await h.prisma.tag.deleteMany();
  await h.prisma.user.deleteMany();
});

function gctx(id: string) {
  return { params: Promise.resolve({ id }) };
}
function pctx(id: string, sid: string) {
  return { params: Promise.resolve({ id, sid }) };
}
function postReq(body?: unknown): Request {
  return new Request("http://test", {
    method: "POST",
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

async function makeUser(id: string) {
  return h.prisma.user.create({
    data: { id, username: `user-${id}`, passwordHash: "x", role: "reader" },
  });
}

async function makeBook(over: Record<string, unknown> = {}) {
  return h.prisma.book.create({
    data: {
      filePath: `/books/${Math.random().toString(36).slice(2)}.epub`,
      format: "epub",
      title: "A Title",
      ...over,
    },
  });
}

async function makeSuggestion(
  bookId: string,
  over: Record<string, unknown> = {},
) {
  return h.prisma.bookSuggestion.create({
    data: {
      bookId,
      source: "openlibrary",
      confidence: 0.5,
      authors: "[]",
      subjects: "[]",
      status: "pending",
      ...over,
    },
  });
}

describe("GET /api/books/[id]/suggestions", () => {
  it("401s an unauthenticated request", async () => {
    signOut();
    const res = await GET(new Request("http://test"), gctx("any"));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthenticated" });
  });

  it("404s an unknown book", async () => {
    await makeUser("u");
    asReader("u");
    const res = await GET(new Request("http://test"), gctx("nope"));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Not found" });
  });

  it("200s only pending candidates, ranked best-confidence-first", async () => {
    await makeUser("u");
    const book = await makeBook();
    await makeSuggestion(book.id, { confidence: 0.4, title: "Low" });
    await makeSuggestion(book.id, { confidence: 0.9, title: "High" });
    await makeSuggestion(book.id, { confidence: 0.7, status: "rejected", title: "Gone" });

    asReader("u");
    const res = await GET(new Request("http://test"), gctx(book.id));
    expect(res.status).toBe(200);
    const json = (await res.json()) as { suggestions: { title: string }[] };
    expect(json.suggestions.map((s) => s.title)).toEqual(["High", "Low"]); // rejected excluded, ranked
  });

  it("parses authors/subjects JSON columns back to arrays", async () => {
    await makeUser("u");
    const book = await makeBook();
    await makeSuggestion(book.id, {
      confidence: 0.8,
      authors: JSON.stringify(["Ada Lovelace"]),
      subjects: JSON.stringify(["Computing"]),
    });

    asReader("u");
    const res = await GET(new Request("http://test"), gctx(book.id));
    const json = (await res.json()) as {
      suggestions: { authors: string[]; subjects: string[] }[];
    };
    expect(json.suggestions[0].authors).toEqual(["Ada Lovelace"]);
    expect(json.suggestions[0].subjects).toEqual(["Computing"]);
  });
});

describe("POST /api/books/[id]/suggestions/[sid] (accept)", () => {
  it("401s an unauthenticated request", async () => {
    signOut();
    const res = await POST(postReq(), pctx("b", "s"));
    expect(res.status).toBe(401);
  });

  it("403s a non-admin reader (catalog curation is admin-only)", async () => {
    await makeUser("u");
    asReader("u");
    const res = await POST(postReq(), pctx("b", "s"));
    expect(res.status).toBe(403);
  });

  it("404s an unknown book", async () => {
    await makeUser("u");
    asAdmin("u");
    const res = await POST(postReq(), pctx("nope", "s"));
    expect(res.status).toBe(404);
  });

  it("404s a suggestion that belongs to a different book (no cross-book leak)", async () => {
    await makeUser("u");
    const bookA = await makeBook();
    const bookB = await makeBook();
    const sugOfB = await makeSuggestion(bookB.id, { confidence: 0.9 });

    asAdmin("u");
    const res = await POST(postReq(), pctx(bookA.id, sugOfB.id));
    expect(res.status).toBe(404);
  });

  it("accept fills empty Book fields, does NOT clobber present ones, marks siblings rejected", async () => {
    await makeUser("u");
    // Book carries a real title already, but no isbn / publisher.
    const book = await makeBook({ title: "Original Title" });
    const chosen = await makeSuggestion(book.id, {
      confidence: 0.95,
      title: "Suggested Title", // must NOT overwrite the present title
      isbn: "9780132350884", // fills the empty isbn
      publisher: "Prentice Hall", // fills the empty publisher
      publishedYear: 2008,
      subjects: JSON.stringify(["Software"]), // → tag
    });
    const sibling = await makeSuggestion(book.id, { confidence: 0.6 });

    asAdmin("u");
    const res = await POST(postReq(), pctx(book.id, chosen.id));
    expect(res.status).toBe(200);

    const after = await h.prisma.book.findUniqueOrThrow({
      where: { id: book.id },
      include: { tags: true },
    });
    expect(after.title).toBe("Original Title"); // present field NOT clobbered (D-3d)
    expect(after.isbn).toBe("9780132350884"); // empty field filled
    expect(after.publisher).toBe("Prentice Hall"); // empty field filled
    expect(after.publishedAt?.getUTCFullYear()).toBe(2008);
    expect(after.tags.map((t) => t.name)).toContain("Software"); // subjects → tags

    const acc = await h.prisma.bookSuggestion.findUniqueOrThrow({ where: { id: chosen.id } });
    const sib = await h.prisma.bookSuggestion.findUniqueOrThrow({ where: { id: sibling.id } });
    expect(acc.status).toBe("accepted");
    expect(sib.status).toBe("rejected"); // siblings rejected in the same transaction
  });

  it("force=true overwrites an already-present field", async () => {
    await makeUser("u");
    const book = await makeBook({ title: "Original Title" });
    const chosen = await makeSuggestion(book.id, {
      confidence: 0.95,
      title: "Forced Title",
    });

    asAdmin("u");
    const res = await POST(postReq({ force: true }), pctx(book.id, chosen.id));
    expect(res.status).toBe(200);

    const after = await h.prisma.book.findUniqueOrThrow({ where: { id: book.id } });
    expect(after.title).toBe("Forced Title"); // force overwrote the present field
  });
});
