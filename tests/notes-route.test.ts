// Slice 2b — Note.highlightId FK: the /api/notes POST wiring + the migration.
//
// Two things are proven here against a REAL ephemeral SQLite DB (Prisma is NOT
// mocked for the data path — same rationale as isolation.test.ts: a mocked
// client would make the column + the ownership filter a tautology):
//
//   1. The HAND-WRITTEN migration is valid SQLite — a Note row can be created
//      carrying a highlightId and read back, and the SetNull FK orphans (not
//      deletes) the note when its highlight is removed.
//   2. POST /api/notes accepts an OPTIONAL highlightId, validates the highlight
//      exists AND belongs to the caller, stores it, and returns it; the
//      no-highlightId path is byte-behaviorally unchanged.
//
// Seam (strategy b, mirrored from isolation.test.ts): the ephemeral PrismaClient
// is built in a vi.hoisted() block so it exists before the hoisted
// vi.mock("@/lib/prisma") factory runs; auth is the @/auth mock driven via
// asReader().

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
  const dir = mkdtempSync(path.join(tmpdir(), "hlr-notes-"));
  const dbFile = path.join(dir, "test.db");
  const url = `file:${dbFile}`;
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  return { dir, url, prisma };
});

vi.mock("@/lib/prisma", () => ({ prisma: h.prisma }));
vi.mock("@/auth", () => ({ auth: vi.fn() }));

import { asReader } from "./helpers/auth-mock";

interface Fixture {
  userA: string;
  userB: string;
  bookId: string;
  highlightOfA: string;
  highlightOfB: string;
}

let fx: Fixture;

beforeAll(async () => {
  execFileSync("npx", ["prisma", "migrate", "deploy"], {
    env: { ...process.env, DATABASE_URL: h.url },
    stdio: "inherit",
  });

  const a = await h.prisma.user.create({
    data: { username: "user-a", passwordHash: "x", role: "reader" },
  });
  const b = await h.prisma.user.create({
    data: { username: "user-b", passwordHash: "x", role: "reader" },
  });
  const book = await h.prisma.book.create({
    data: { filePath: "/seed/x.epub", format: "epub", title: "Seed Book" },
  });
  const hlA = await h.prisma.highlight.create({
    data: {
      bookId: book.id,
      userId: a.id,
      anchor: JSON.stringify({ type: "epub-cfi-range", cfiStart: "/6/2", cfiEnd: "/6/4" }),
      text: "A's highlight",
      color: "yellow",
    },
  });
  const hlB = await h.prisma.highlight.create({
    data: {
      bookId: book.id,
      userId: b.id,
      anchor: JSON.stringify({ type: "epub-cfi-range", cfiStart: "/6/8", cfiEnd: "/6/10" }),
      text: "B's highlight",
      color: "green",
    },
  });

  fx = {
    userA: a.id,
    userB: b.id,
    bookId: book.id,
    highlightOfA: hlA.id,
    highlightOfB: hlB.id,
  };
});

afterAll(async () => {
  await h.prisma.$disconnect();
  rmSync(h.dir, { recursive: true, force: true });
});

beforeEach(() => {
  vi.clearAllMocks();
  asReader(fx.userA);
});

const postBody = (payload: unknown) =>
  new Request("http://t/api/notes", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });

// ---------------------------------------------------------------------------
// 1. The migration is valid SQLite — column exists, round-trips, SetNull works.
//    These hit Prisma directly (no route) so they fail loudly if the
//    hand-written migration.sql is malformed or the column is missing.
// ---------------------------------------------------------------------------
describe("Note.highlightId migration (hand-written, additive)", () => {
  it("a Note can be created carrying a highlightId and read back", async () => {
    const note = await h.prisma.note.create({
      data: {
        bookId: fx.bookId,
        userId: fx.userA,
        anchor: JSON.stringify({ type: "epub-cfi", cfi: "/6/2" }),
        body: "bound note",
        highlightId: fx.highlightOfA,
      },
    });
    const read = await h.prisma.note.findUnique({ where: { id: note.id } });
    expect(read?.highlightId).toBe(fx.highlightOfA);
    await h.prisma.note.delete({ where: { id: note.id } });
  });

  it("deleting the highlight SETS the note's highlightId to NULL and KEEPS the note (onDelete: SetNull)", async () => {
    // A throwaway highlight + note bound to it, then delete the highlight.
    const hl = await h.prisma.highlight.create({
      data: {
        bookId: fx.bookId,
        userId: fx.userA,
        anchor: JSON.stringify({ type: "epub-cfi-range", cfiStart: "/6/20", cfiEnd: "/6/22" }),
        text: "ephemeral highlight",
        color: "blue",
      },
    });
    const note = await h.prisma.note.create({
      data: {
        bookId: fx.bookId,
        userId: fx.userA,
        anchor: JSON.stringify({ type: "epub-cfi", cfi: "/6/20" }),
        body: "note that must survive its highlight",
        highlightId: hl.id,
      },
    });

    await h.prisma.highlight.delete({ where: { id: hl.id } });

    const survivor = await h.prisma.note.findUnique({ where: { id: note.id } });
    expect(survivor).not.toBeNull(); // note KEPT
    expect(survivor?.highlightId).toBeNull(); // FK orphaned, not cascaded
    expect(survivor?.body).toBe("note that must survive its highlight");

    await h.prisma.note.delete({ where: { id: note.id } });
  });
});

// ---------------------------------------------------------------------------
// 2. POST /api/notes — the highlightId wiring.
// ---------------------------------------------------------------------------
describe("POST /api/notes — optional highlightId", () => {
  async function post(payload: unknown) {
    const { POST } = await import("@/app/api/notes/route");
    return POST(postBody(payload));
  }

  it("persists a valid OWN highlightId and returns it in the response", async () => {
    const res = await post({
      bookId: fx.bookId,
      anchor: { type: "epub-cfi", cfi: "/6/2" },
      body: "paired note",
      highlightId: fx.highlightOfA,
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { id: string; highlightId: string | null };
    expect(json.highlightId).toBe(fx.highlightOfA);

    const stored = await h.prisma.note.findUnique({ where: { id: json.id } });
    expect(stored?.highlightId).toBe(fx.highlightOfA);
    await h.prisma.note.delete({ where: { id: json.id } });
  });

  it("REJECTS a highlightId that belongs to ANOTHER user (does not store, no note created)", async () => {
    const before = await h.prisma.note.count();
    const res = await post({
      bookId: fx.bookId,
      anchor: { type: "epub-cfi", cfi: "/6/2" },
      body: "stolen-anchor note",
      highlightId: fx.highlightOfB, // owned by B, caller is A
    });
    expect(res.status).toBe(404);
    expect(await h.prisma.note.count()).toBe(before); // nothing persisted
  });

  it("REJECTS a highlightId for a non-existent highlight (no note created)", async () => {
    const before = await h.prisma.note.count();
    const res = await post({
      bookId: fx.bookId,
      anchor: { type: "epub-cfi", cfi: "/6/2" },
      body: "phantom-anchor note",
      highlightId: "does-not-exist",
    });
    expect(res.status).toBe(404);
    expect(await h.prisma.note.count()).toBe(before);
  });

  it("still creates a note with NO highlightId (regression — unchanged path)", async () => {
    const res = await post({
      bookId: fx.bookId,
      anchor: { type: "epub-cfi", cfi: "/6/2" },
      body: "freeform note",
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { id: string; highlightId: string | null };
    expect(json.highlightId).toBeNull();

    const stored = await h.prisma.note.findUnique({ where: { id: json.id } });
    expect(stored?.highlightId).toBeNull();
    expect(stored?.body).toBe("freeform note");
    await h.prisma.note.delete({ where: { id: json.id } });
  });
});
