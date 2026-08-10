// AUTHZ — dual-auth guard for binary-content routes (book file + cover).
//
// The book-file and cover routes are linked from the OPDS acquisition feed and
// fetched by BOTH the browser reader (NextAuth cookie session) and OPDS machine
// clients (per-user Basic/Bearer token). They are exempt from the cookie-only
// middleware gate (src/auth.config.ts) exactly like /api/opds, so they MUST
// authenticate in-route. authenticateReaderRequest is that guard: it accepts a
// valid cookie session OR a valid OPDS token, and returns null otherwise.
//
// This suite proves both accept-paths against the REAL token table (an
// ephemeral SQLite DB, same rationale as opds-auth.test.ts — a mocked client
// would make the token lookup a tautology) while mocking ONLY the @/auth seam
// to drive the cookie-session branch.

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { tokenExpiry } from "@/lib/opds-auth";
import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import { createHash } from "node:crypto";

// --- hoisted: ephemeral DB url + client before any module import ------------
const h = await vi.hoisted(async () => {
  const { mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const path = (await import("node:path")).default;
  const { PrismaClient } = await import("@prisma/client");
  const dir = mkdtempSync(path.join(tmpdir(), "hlr-reader-auth-"));
  const dbFile = path.join(dir, "test.db");
  const url = `file:${dbFile}`;
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  return { dir, url, prisma };
});

// Inject the ephemeral client wherever the guard `import { prisma }`.
vi.mock("@/lib/prisma", () => ({ prisma: h.prisma }));
// Mock the single auth boundary so the cookie-session branch is drivable.
vi.mock("@/auth", () => ({ auth: vi.fn() }));

import { authenticateReaderRequest } from "@/lib/reader-auth";
import { auth } from "@/auth";

const TOKEN = "reader-token-AbC123_base64url";
const sha = (t: string) => createHash("sha256").update(t).digest("hex");

let userId: string;

beforeAll(async () => {
  execFileSync("npx", ["prisma", "migrate", "deploy"], {
    env: { ...process.env, DATABASE_URL: h.url },
    stdio: "inherit",
  });
  const u = await h.prisma.user.create({
    data: { username: "reader", passwordHash: "x", role: "reader" },
  });
  userId = u.id;
  await h.prisma.opdsToken.create({
    data: { userId: u.id, tokenHash: sha(TOKEN), label: "reader-device", expiresAt: tokenExpiry() },
  });
});

afterAll(async () => {
  await h.prisma.$disconnect();
  rmSync(h.dir, { recursive: true, force: true });
});

// Default to signed-out before each case so a leaked session can't mask a gate.
import { beforeEach } from "vitest";
beforeEach(() => {
  vi.mocked(auth).mockResolvedValue(null as never);
});

const bearer = (token: string) =>
  new Request("http://t/api/books/x/file", {
    headers: { Authorization: "Bearer " + token },
  });
const noHeader = () => new Request("http://t/api/books/x/file");

describe("authenticateReaderRequest — cookie OR OPDS token", () => {
  it("rejects a request with no cookie and no token (null)", async () => {
    expect(await authenticateReaderRequest(noHeader())).toBeNull();
  });

  it("accepts a valid browser cookie session", async () => {
    // The cookie path resolves through the live gate, so the session has to
    // name an account that exists — `userId` is the seeded reader.
    vi.mocked(auth).mockResolvedValue({
      user: { id: userId, role: "reader" },
    } as never);
    const u = await authenticateReaderRequest(noHeader());
    expect(u).not.toBeNull();
    expect(u?.id).toBe(userId);
  });

  it("refuses a cookie session whose account has been deleted", async () => {
    // The revocation case, at the binary-content guard: a token that still
    // decodes, naming a row that is gone. Before the gate re-read the row this
    // returned a user and the deleted account kept downloading books.
    vi.mocked(auth).mockResolvedValue({
      user: { id: "deleted-account", role: "reader" },
    } as never);
    expect(await authenticateReaderRequest(noHeader())).toBeNull();
  });

  it("accepts a valid OPDS token when no cookie is present", async () => {
    const u = await authenticateReaderRequest(bearer(TOKEN));
    expect(u).not.toBeNull();
    expect(u?.id).toBe(userId);
  });

  it("rejects an unknown OPDS token", async () => {
    expect(await authenticateReaderRequest(bearer("not-a-real-token"))).toBeNull();
  });
});
