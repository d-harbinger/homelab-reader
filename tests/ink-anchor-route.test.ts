// INK-ANCHOR-01 — /api/ink accepts both stroke shapes: a PDF stroke fastened to
// a page number, and an EPUB stroke fastened to a block CFI. Exactly one of
// `page` / `anchor` per stroke — a discriminated union, no sentinel page.
//
// Seam mirrors tests/color-key-route.test.ts: ephemeral PrismaClient on a temp
// SQLite file, mocked @/auth seam, committed migrations applied in beforeAll.
//
// The load-bearing assertion is REGRESSION, not the new feature: a PDF stroke's
// request and response must be byte-for-byte what they were before block
// anchors existed. The `anchor` key is absent — not null — on a legacy stroke.
//
// Branches exercised:
//   POST — 401 signed out · 400 neither page nor anchor · 400 both ·
//          400 invalid page (0 / non-integer) · 400 malformed anchor ·
//          400 over-long CFI · 400 page-kind anchor via the anchor field ·
//          400 invalid points · 404 unknown book · block-anchor happy path ·
//          legacy page path unchanged · per-instrument color/width still gated ·
//          highlighter opacity still forced
//   GET  — 401 signed out · 400 missing bookId · anchor returned for block
//          strokes and omitted for legacy · cross-user isolation

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
  const dir = mkdtempSync(path.join(tmpdir(), "hlr-inkanchor-"));
  const dbFile = path.join(dir, "test.db");
  const url = `file:${dbFile}`;
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  return { dir, url, prisma };
});

vi.mock("@/lib/prisma", () => ({ prisma: h.prisma }));
vi.mock("@/auth", () => ({ auth: vi.fn() }));

import { asReader, signOut } from "./helpers/auth-mock";
import { HIGHLIGHTER_OPACITY, INK_CFI_MAX_LENGTH } from "@/lib/ink";
import { GET, POST } from "@/app/api/ink/route";

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
  await h.prisma.inkStroke.deleteMany();
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
    data: { filePath: "/books/python/think.epub", format: "epub", title: "Think Python" },
  });
}

function postReq(body: unknown) {
  return new Request("http://test/api/ink", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function getReq(bookId?: string) {
  const qs = bookId ? `?bookId=${encodeURIComponent(bookId)}` : "";
  return new Request(`http://test/api/ink${qs}`);
}

const POINTS = [
  [0.1, 0.1, 0.5],
  [0.4, 0.6, 0.7],
];
const BLOCK = { kind: "block", cfi: "epubcfi(/6/4!/4/2/2)", section: 3 };

describe("POST /api/ink — the union gate", () => {
  it("401s an unauthenticated request", async () => {
    const res = await POST(postReq({ bookId: "b", page: 1, points: POINTS }));
    expect(res.status).toBe(401);
  });

  it("400s with neither page nor anchor", async () => {
    await makeUser("u1");
    const book = await makeBook();
    asReader("u1");
    expect((await POST(postReq({ bookId: book.id, points: POINTS }))).status).toBe(400);
  });

  it("400s with BOTH page and anchor — a stroke is fastened one way", async () => {
    await makeUser("u1");
    const book = await makeBook();
    asReader("u1");
    const res = await POST(
      postReq({ bookId: book.id, page: 2, anchor: BLOCK, points: POINTS }),
    );
    expect(res.status).toBe(400);
  });

  it("400s without a bookId", async () => {
    await makeUser("u1");
    asReader("u1");
    expect((await POST(postReq({ page: 1, points: POINTS }))).status).toBe(400);
  });
});

describe("POST /api/ink — the legacy page path is unchanged", () => {
  it("still rejects a below-1 or non-integer page", async () => {
    await makeUser("u1");
    const book = await makeBook();
    asReader("u1");
    expect((await POST(postReq({ bookId: book.id, page: 0, points: POINTS }))).status).toBe(400);
    expect((await POST(postReq({ bookId: book.id, page: 1.5, points: POINTS }))).status).toBe(400);
    expect((await POST(postReq({ bookId: book.id, page: "1", points: POINTS }))).status).toBe(400);
  });

  it("still rejects invalid points and an unknown book", async () => {
    await makeUser("u1");
    const book = await makeBook();
    asReader("u1");
    expect((await POST(postReq({ bookId: book.id, page: 1, points: [] }))).status).toBe(400);
    expect((await POST(postReq({ bookId: "nope", page: 1, points: POINTS }))).status).toBe(404);
  });

  it("saves a page stroke and answers the exact pre-anchor payload", async () => {
    await makeUser("u1");
    const book = await makeBook();
    asReader("u1");
    const res = await POST(
      postReq({ bookId: book.id, page: 4, points: POINTS, color: "#dc2626", width: 2.5 }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    // Byte-identical to the shape shipped before block anchors: same keys, same
    // order, and NO anchor key. A PDF client must not see the union at all.
    expect(Object.keys(body)).toEqual([
      "id",
      "page",
      "color",
      "width",
      "opacity",
      "kind",
      "points",
    ]);
    expect(body).toMatchObject({
      page: 4,
      color: "#dc2626",
      width: 2.5,
      opacity: 1,
      kind: "pen",
      points: POINTS,
    });
    const row = await h.prisma.inkStroke.findUnique({ where: { id: body.id } });
    expect(row?.page).toBe(4);
    expect(row?.anchor).toBeNull();
  });

  it("still gates color/width per instrument and forces the highlighter opacity", async () => {
    await makeUser("u1");
    const book = await makeBook();
    asReader("u1");
    // A highlighter cannot carry a pen swatch or a pen nib.
    expect(
      (await POST(postReq({ bookId: book.id, page: 1, points: POINTS, kind: "highlighter", color: "#1c1c1e" }))).status,
    ).toBe(400);
    expect(
      (await POST(postReq({ bookId: book.id, page: 1, points: POINTS, kind: "highlighter", width: 4 }))).status,
    ).toBe(400);
    expect(
      (await POST(postReq({ bookId: book.id, page: 1, points: POINTS, kind: "marker" }))).status,
    ).toBe(400);
    // The highlighter's translucency is fixed server-side, never client-chosen.
    const res = await POST(
      postReq({ bookId: book.id, page: 1, points: POINTS, kind: "highlighter", opacity: 1 }),
    );
    expect((await res.json()).opacity).toBe(HIGHLIGHTER_OPACITY);
  });
});

describe("POST /api/ink — the block-anchor path", () => {
  it("saves a block-anchored stroke and returns the anchor", async () => {
    await makeUser("u1");
    const book = await makeBook();
    asReader("u1");
    const res = await POST(postReq({ bookId: book.id, anchor: BLOCK, points: POINTS }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ page: null, anchor: BLOCK, points: POINTS, kind: "pen" });

    // The row is the other half of the union: anchor set, page null. A null
    // page is what keeps EPUB strokes out of every PDF page query.
    const row = await h.prisma.inkStroke.findUnique({ where: { id: body.id } });
    expect(row?.page).toBeNull();
    expect(JSON.parse(row!.anchor!)).toEqual(BLOCK);
  });

  it("400s a malformed anchor", async () => {
    await makeUser("u1");
    const book = await makeBook();
    asReader("u1");
    for (const anchor of [
      "epubcfi(/6/4)", // a bare string, not an anchor object
      {},
      { kind: "block" }, // no cfi
      { kind: "block", cfi: "/6/4" }, // no section
      { kind: "block", cfi: "/6/4", section: -1 },
      { kind: "block", cfi: "/6/4", section: 1.5 },
      { kind: "block", cfi: "", section: 0 },
      { kind: "pixel", x: 1, y: 2 },
      null,
    ]) {
      const res = await POST(postReq({ bookId: book.id, anchor, points: POINTS }));
      expect(res.status, `anchor: ${JSON.stringify(anchor)}`).toBe(400);
    }
    expect(await h.prisma.inkStroke.count()).toBe(0);
  });

  it("400s an over-long CFI", async () => {
    await makeUser("u1");
    const book = await makeBook();
    asReader("u1");
    const res = await POST(
      postReq({
        bookId: book.id,
        anchor: { kind: "block", cfi: "x".repeat(INK_CFI_MAX_LENGTH + 1), section: 0 },
        points: POINTS,
      }),
    );
    expect(res.status).toBe(400);
  });

  it("400s a page-kind anchor sent through the anchor field", async () => {
    await makeUser("u1");
    const book = await makeBook();
    asReader("u1");
    // `page` is the one way to say "page". Accepting it here too would store a
    // stroke with a null page that no PDF page query can ever match — a row
    // that saves and then never renders.
    const res = await POST(
      postReq({ bookId: book.id, anchor: { kind: "page", page: 2 }, points: POINTS }),
    );
    expect(res.status).toBe(400);
  });
});

describe("GET /api/ink", () => {
  it("401s an unauthenticated request and 400s without a bookId", async () => {
    expect((await GET(getReq("b"))).status).toBe(401);
    await makeUser("u1");
    asReader("u1");
    expect((await GET(getReq())).status).toBe(400);
  });

  it("returns the anchor for block strokes and omits the key for legacy ones", async () => {
    await makeUser("u1");
    const book = await makeBook();
    asReader("u1");
    await POST(postReq({ bookId: book.id, page: 7, points: POINTS }));
    await POST(postReq({ bookId: book.id, anchor: BLOCK, points: POINTS }));

    const { strokes } = await (await GET(getReq(book.id))).json();
    expect(strokes).toHaveLength(2);

    const [legacy, block] = strokes;
    expect(legacy.page).toBe(7);
    expect("anchor" in legacy).toBe(false);
    expect(Object.keys(legacy)).toEqual([
      "id",
      "page",
      "color",
      "width",
      "opacity",
      "kind",
      "points",
    ]);

    expect(block.anchor).toEqual(BLOCK);
    expect(block.page).toBeNull();
  });

  it("isolates strokes per user on the same book", async () => {
    await makeUser("u1");
    await makeUser("u2");
    const book = await makeBook();

    asReader("u1");
    await POST(postReq({ bookId: book.id, anchor: BLOCK, points: POINTS }));

    // U2 shares the book but must never see U1's marks.
    asReader("u2");
    expect((await (await GET(getReq(book.id))).json()).strokes).toEqual([]);
    await POST(postReq({ bookId: book.id, page: 1, points: POINTS }));

    const u2 = (await (await GET(getReq(book.id))).json()).strokes;
    expect(u2).toHaveLength(1);
    expect(u2[0].page).toBe(1);

    asReader("u1");
    const u1 = (await (await GET(getReq(book.id))).json()).strokes;
    expect(u1).toHaveLength(1);
    expect(u1[0].anchor).toEqual(BLOCK);
  });
});
