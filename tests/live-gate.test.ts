// REVOCATION — taking access away has to mean now.
//
// The session is a JWT. `role` is stamped into it once, at sign-in, and nothing
// afterwards reaches back to change it; Auth.js's default session life is
// thirty days. So a gate that reads the role out of the token is a gate that
// enforces whatever was true a month ago.
//
// Concretely, on the bug this suite pins: an admin demotes a second admin to
// `reader` in the user-management screen. The demoted account's browser still
// holds a token saying "admin". If withAdmin trusts that claim, the demoted
// account can walk straight back into POST /api/users, promote itself, and
// delete the account that demoted it. Deleting the account instead of demoting
// it was no better for reads — the id in the token still resolved, so the
// deleted account kept browsing, downloading and streaming.
//
// The fix (src/lib/current-user.ts) re-reads the User row on every gated call.
// These tests are written against a REAL ephemeral database because that is the
// only way the assertion means anything: the whole claim is "the database is
// consulted", and a mocked client would let the gate pass by consulting nothing.

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";

const h = await vi.hoisted(async () => {
  const { mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const path = (await import("node:path")).default;
  const { PrismaClient } = await import("@prisma/client");
  const dir = mkdtempSync(path.join(tmpdir(), "hlr-live-gate-"));
  const url = `file:${path.join(dir, "test.db")}`;
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  return { dir, url, prisma };
});

vi.mock("@/lib/prisma", () => ({ prisma: h.prisma }));
vi.mock("@/auth", () => ({ auth: vi.fn() }));

// The scanner is mocked so the admin happy-path returns without walking a
// filesystem; the gate is what is under test, not the scan.
vi.mock("@/lib/scanner", () => ({ walkAndScan: vi.fn(async () => ({ scanned: 0, errors: 0 })) }));
vi.mock("@/lib/scanner/locations", () => ({
  listScanLocations: vi.fn(async () => []),
  enabledLocationPaths: vi.fn(async () => []),
  touchScanLocation: vi.fn(async () => {}),
}));
vi.mock("@/lib/scanner/watcher", () => ({
  markFullScan: vi.fn(() => {}),
  watcherStatus: vi.fn(() => ({
    running: false,
    watchedPaths: [],
    lastError: null,
    lastFullScanAt: null,
  })),
}));

import { setSession, signOut } from "./helpers/auth-mock";
import { GET as usersGet } from "@/app/api/users/route";
import { GET as booksGet } from "@/app/api/books/route";
import { GET as meGet } from "@/app/api/me/route";

let adminId: string;

beforeAll(async () => {
  execFileSync("npx", ["prisma", "migrate", "deploy"], {
    env: { ...process.env, DATABASE_URL: h.url },
    stdio: "inherit",
  });
  // Generous timeout: this shells out to `npx prisma migrate deploy`, and
  // vitest's 10s default is tight for that when several suites do it at once.
}, 60_000);

afterAll(async () => {
  await h.prisma.$disconnect();
  rmSync(h.dir, { recursive: true, force: true });
});

beforeEach(async () => {
  vi.clearAllMocks();
  signOut();
  await h.prisma.user.deleteMany();
  const admin = await h.prisma.user.create({
    data: { username: "the-admin", passwordHash: "x", role: "admin" },
  });
  adminId = admin.id;
});

// The token this account is still holding: it says "admin", because it did when
// it was issued. Every test below keeps this claim fixed and changes only the
// database, which is exactly the shape of the real attack.
function stillHoldingAnAdminToken(id: string) {
  setSession({ user: { id, role: "admin" } });
}

const booksReq = () => new Request("http://test/api/books");

describe("a demoted admin loses admin on the very next call", () => {
  it("passes the admin gate while the row still says admin", async () => {
    stillHoldingAnAdminToken(adminId);
    const res = await usersGet(new Request("http://test/api/users"));
    expect(res.status).toBe(200);
  });

  it("is refused after the row is demoted, with the SAME token", async () => {
    stillHoldingAnAdminToken(adminId);
    expect((await usersGet(new Request("http://test/api/users"))).status).toBe(200);

    // The only thing that changes is the database row. The session is untouched
    // — the browser still holds a token whose `role` claim reads "admin".
    await h.prisma.user.update({ where: { id: adminId }, data: { role: "reader" } });

    const res = await usersGet(new Request("http://test/api/users"));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "forbidden" });
  });

  it("reports the demoted role to the client, so the admin UI disappears", async () => {
    stillHoldingAnAdminToken(adminId);
    await h.prisma.user.update({ where: { id: adminId }, data: { role: "reader" } });

    const res = await meGet(new Request("http://test/api/me"));
    expect(res.status).toBe(200);
    expect((await res.json()).user.role).toBe("reader");
  });
});

describe("a deleted account loses everything on the very next call", () => {
  it("cannot reach an admin route", async () => {
    stillHoldingAnAdminToken(adminId);
    await h.prisma.user.delete({ where: { id: adminId } });

    const res = await usersGet(new Request("http://test/api/users"));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthenticated" });
  });

  it("cannot even browse the catalogue", async () => {
    // The read side matters as much as the write side: before the re-read, a
    // deleted account kept listing, downloading and streaming the library
    // because its id still resolved out of the token.
    stillHoldingAnAdminToken(adminId);
    expect((await booksGet(booksReq())).status).toBe(200);

    await h.prisma.user.delete({ where: { id: adminId } });

    const res = await booksGet(booksReq());
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthenticated" });
  });

  it("cannot ask who it is", async () => {
    stillHoldingAnAdminToken(adminId);
    await h.prisma.user.delete({ where: { id: adminId } });
    expect((await meGet(new Request("http://test/api/me"))).status).toBe(401);
  });
});
