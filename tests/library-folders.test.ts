// LIBRARY-01 — GET /api/library/folders returns the on-disk shelf tree,
// session-gated and path-private.
//
// Seam mirrors tests/isolation.test.ts: a vi.hoisted() ephemeral PrismaClient
// bound to a temp SQLite file (injected via vi.mock("@/lib/prisma")), the
// @/auth seam mocked so the real getCurrentUser logic runs against a fake
// session, migrations applied to the throwaway file in beforeAll. The happy
// path genuinely queries Prisma (the tree is derived from real Book rows); the
// unauthenticated case short-circuits before any query.

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
  const dir = mkdtempSync(path.join(tmpdir(), "hlr-folders-"));
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
import { GET } from "@/app/api/library/folders/route";

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
  await h.prisma.book.deleteMany();
  await h.prisma.scanLocation.deleteMany();
});

describe("GET /api/library/folders", () => {
  it("returns a folder tree derived from book paths under the scan root", async () => {
    await h.prisma.scanLocation.create({ data: { path: "/books" } });
    for (const fp of [
      "/books/python/a.epub",
      "/books/python/web/b.epub",
      "/books/ai/c.epub",
    ]) {
      await h.prisma.book.create({
        data: { filePath: fp, format: "epub", title: fp },
      });
    }
    asReader("u-reader"); // authenticated session
    const res = await GET();
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.tree.totalCount).toBe(3);
    expect(body.tree.children.map((c: { name: string }) => c.name)).toEqual([
      "ai",
      "python",
    ]);
    // privacy: no absolute scan-root path anywhere in the payload
    expect(JSON.stringify(body)).not.toContain("/books");
  });

  it("401s an unauthenticated request", async () => {
    signOut(); // no session
    const res = await GET();
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthenticated" });
  });
});
