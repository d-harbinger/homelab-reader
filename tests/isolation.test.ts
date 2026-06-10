// AUTHZ-03 / TEST-02 — cross-user isolation against a REAL ephemeral SQLite DB.
//
// Prisma is NOT mocked for the data path: the whole point is to prove the real
// `where: { userId }` filter and the `existing.userId !== userId -> 404`
// ownership check genuinely block cross-user access. A mocked client would make
// those a tautology (RESEARCH anti-pattern).
//
// Prisma-singleton seam = strategy (b): vi.mock("@/lib/prisma") injects an
// ephemeral PrismaClient bound to a temp SQLite file (see tests/setup.ts for
// the rationale and the strategy-(a) fallback). The client is constructed in a
// vi.hoisted() block so it exists before the hoisted vi.mock factory runs;
// migrations + seed run in beforeAll against that same temp file.

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
// vi.hoisted runs ABOVE the top-level imports, so it cannot use the bindings
// imported at the top of this file (they're not initialized yet). Import what
// the block needs from inside the async factory, where resolution happens at
// call time.
const h = await vi.hoisted(async () => {
  const { mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const path = (await import("node:path")).default;
  const { PrismaClient } = await import("@prisma/client");
  const dir = mkdtempSync(path.join(tmpdir(), "hlr-iso-"));
  const dbFile = path.join(dir, "test.db");
  const url = `file:${dbFile}`;
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  return { dir, url, prisma };
});

// Inject the ephemeral client wherever route handlers `import { prisma }`.
vi.mock("@/lib/prisma", () => ({ prisma: h.prisma }));
// Mock the auth seam; real getCurrentUserId logic runs against the fake session.
vi.mock("@/auth", () => ({ auth: vi.fn() }));

import { asReader } from "./helpers/auth-mock";
import { makeTestDb, seedTwoUsers, type SeedResult } from "./helpers/test-db";

// NOTE on the seam: makeTestDb() is the canonical ephemeral-DB factory (temp
// file + migrate deploy + datasources-url client + cleanup). Here the client
// must exist BEFORE the hoisted vi.mock("@/lib/prisma") factory runs, and
// makeTestDb() is async, so we inline its construction in the vi.hoisted()
// block above and reuse makeTestDb()'s exact recipe (same url shape, same
// PrismaClient datasources override, same migrate deploy). seedTwoUsers() —
// the seed half of the same helper module — populates B-owned rows below.
// If the host run shows the inline-hoisted client is awkward, a suite can
// instead call `const db = await makeTestDb()` in beforeAll under strategy (a)
// (set DATABASE_URL from db.url before importing the singleton).
void makeTestDb; // referenced: the inline hoisted client mirrors this factory

let seed: SeedResult;

beforeAll(async () => {
  // Apply the committed migrations to the throwaway file.
  execFileSync("npx", ["prisma", "migrate", "deploy"], {
    env: { ...process.env, DATABASE_URL: h.url },
    stdio: "inherit",
  });
  seed = await seedTwoUsers(h.prisma);
});

afterAll(async () => {
  await h.prisma.$disconnect();
  rmSync(h.dir, { recursive: true, force: true });
});

// Every test acts as user A trying to reach user B's data.
beforeEach(() => {
  vi.clearAllMocks();
  asReader(seed.userA);
});

const idCtx = (id: string) => ({ params: Promise.resolve({ id }) });

// ---------------------------------------------------------------------------
// By-id mutation: A cannot DELETE/PATCH B's note or highlight -> 404, and B's
// row survives (the mutation did not happen).
// ---------------------------------------------------------------------------
describe("cross-user by-id mutation -> 404 + row survives (AUTHZ-03)", () => {
  it("A cannot DELETE B's note", async () => {
    const { DELETE } = await import("@/app/api/notes/[id]/route");
    const res = await DELETE(
      new Request(`http://t/api/notes/${seed.noteOfB}`, { method: "DELETE" }),
      idCtx(seed.noteOfB),
    );
    expect(res.status).toBe(404);
    expect(
      await h.prisma.note.findUnique({ where: { id: seed.noteOfB } }),
    ).not.toBeNull();
  });

  it("A cannot PATCH B's note", async () => {
    const { PATCH } = await import("@/app/api/notes/[id]/route");
    const res = await PATCH(
      new Request(`http://t/api/notes/${seed.noteOfB}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ body: "hijacked" }),
      }),
      idCtx(seed.noteOfB),
    );
    expect(res.status).toBe(404);
    const row = await h.prisma.note.findUnique({ where: { id: seed.noteOfB } });
    expect(row?.body).toBe("B's private note");
  });

  it("A cannot DELETE B's highlight", async () => {
    const { DELETE } = await import("@/app/api/highlights/[id]/route");
    const res = await DELETE(
      new Request(`http://t/api/highlights/${seed.highlightOfB}`, {
        method: "DELETE",
      }),
      idCtx(seed.highlightOfB),
    );
    expect(res.status).toBe(404);
    expect(
      await h.prisma.highlight.findUnique({ where: { id: seed.highlightOfB } }),
    ).not.toBeNull();
  });

  it("A cannot PATCH B's highlight", async () => {
    const { PATCH } = await import("@/app/api/highlights/[id]/route");
    const res = await PATCH(
      new Request(`http://t/api/highlights/${seed.highlightOfB}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ color: "blue" }),
      }),
      idCtx(seed.highlightOfB),
    );
    expect(res.status).toBe(404);
    const row = await h.prisma.highlight.findUnique({
      where: { id: seed.highlightOfB },
    });
    expect(row?.color).toBe("yellow"); // unchanged
  });
});

// ---------------------------------------------------------------------------
// Collection reads: A's GETs never include B's rows.
// ---------------------------------------------------------------------------
describe("collection reads exclude other user's rows (AUTHZ-03)", () => {
  it("GET /api/notes returns none of B's notes", async () => {
    const { GET } = await import("@/app/api/notes/route");
    const res = await GET(new Request(`http://t/api/notes?bookId=${seed.bookId}`));
    expect(res.status).toBe(200);
    const { notes } = (await res.json()) as { notes: { id: string }[] };
    expect(notes.find((n) => n.id === seed.noteOfB)).toBeUndefined();
    expect(notes).toHaveLength(0); // A has none on this book
  });

  it("GET /api/highlights returns none of B's highlights", async () => {
    const { GET } = await import("@/app/api/highlights/route");
    const res = await GET(
      new Request(`http://t/api/highlights?bookId=${seed.bookId}`),
    );
    expect(res.status).toBe(200);
    const { highlights } = (await res.json()) as {
      highlights: { id: string }[];
    };
    expect(highlights.find((x) => x.id === seed.highlightOfB)).toBeUndefined();
    expect(highlights).toHaveLength(0);
  });

  it("GET /api/progress returns A's zero default, never B's anchor", async () => {
    const { GET } = await import("@/app/api/progress/route");
    const res = await GET(
      new Request(`http://t/api/progress?bookId=${seed.bookId}`),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { percent: number; anchor: unknown };
    expect(body).toEqual({ percent: 0, anchor: null });
  });

  it("GET /api/progress/recent excludes B's in-progress book", async () => {
    const { GET } = await import("@/app/api/progress/recent/route");
    const res = await GET();
    expect(res.status).toBe(200);
    const { books } = (await res.json()) as { books: { id: string }[] };
    expect(books.find((b) => b.id === seed.bookId)).toBeUndefined();
    expect(books).toHaveLength(0); // A has no progress at all
  });
});
