// S1 — GET /api/opds/progress?bookId=... — the OPDS-context progress READ.
//
// Prisma is NOT mocked for the data path (same rationale as opds-tokens.test.ts
// and isolation.test.ts): the point is to prove the real per-token `where:
// { bookId_userId: { bookId, userId } }` lookup genuinely isolates one account's
// reading position from another's, and that write-then-read over the OPDS path
// round-trips the exact { percent, anchor, updatedAt } shape. A mocked client
// would make those a tautology.
//
// Seam: vi.mock("@/lib/prisma") injects an ephemeral PrismaClient bound to a
// temp SQLite file, built in a vi.hoisted() block so it exists before the
// hoisted vi.mock factory runs. The committed migrations are applied in
// beforeAll against that temp file. There is no @/auth mock here: the OPDS path
// authenticates on the Authorization header via a real prisma.opdsToken lookup,
// not the cookie session.

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import { createHash } from "node:crypto";

// --- hoisted: build the temp DB url + client before any module import -------
const h = await vi.hoisted(async () => {
  const { mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const path = (await import("node:path")).default;
  const { PrismaClient } = await import("@prisma/client");
  const dir = mkdtempSync(path.join(tmpdir(), "hlr-prog-"));
  const dbFile = path.join(dir, "test.db");
  const url = `file:${dbFile}`;
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  return { dir, url, prisma };
});

// Inject the ephemeral client wherever the route handlers `import { prisma }`.
vi.mock("@/lib/prisma", () => ({ prisma: h.prisma }));

const sha = (t: string) => createHash("sha256").update(t).digest("hex");

// Synthetic fixtures only — no real hostnames, IPs, usernames, or tokens.
const TOKEN_A = "token-alpha-synthetic";
const TOKEN_B = "token-bravo-synthetic";

interface Seed {
  bookId: string;
}
let seed: Seed;

// Build a request carrying an OPDS Basic credential for the given token.
function opdsReq(token: string | null, bookId?: string): Request {
  const qs = bookId === undefined ? "" : `?bookId=${encodeURIComponent(bookId)}`;
  const headers: Record<string, string> = {};
  if (token !== null) {
    const cred = Buffer.from(`ignored-username:${token}`).toString("base64");
    headers.authorization = `Basic ${cred}`;
  }
  return new Request(`http://t/api/opds/progress${qs}`, { headers });
}

beforeAll(async () => {
  // Apply the committed migrations to the throwaway file.
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
  await h.prisma.opdsToken.create({
    data: { userId: a.id, tokenHash: sha(TOKEN_A), label: "a-device" },
  });
  await h.prisma.opdsToken.create({
    data: { userId: b.id, tokenHash: sha(TOKEN_B), label: "b-device" },
  });
  const book = await h.prisma.book.create({
    data: {
      title: "Synthetic Title",
      format: "epub",
      filePath: "/synthetic.epub",
    },
  });

  seed = { bookId: book.id };
});

afterAll(async () => {
  await h.prisma.$disconnect();
  rmSync(h.dir, { recursive: true, force: true });
});

describe("GET /api/opds/progress — auth guard", () => {
  it("no Authorization header -> 401 with the pinned WWW-Authenticate challenge", async () => {
    const { GET } = await import("@/app/api/opds/progress/route");
    const res = await GET(opdsReq(null, seed.bookId));
    expect(res.status).toBe(401);
    expect(res.headers.get("WWW-Authenticate")).toBe(
      'Basic realm="homelab-reader OPDS"',
    );
  });

  it("invalid/unknown token -> 401", async () => {
    const { GET } = await import("@/app/api/opds/progress/route");
    const res = await GET(opdsReq("not-a-real-token", seed.bookId));
    expect(res.status).toBe(401);
    expect(res.headers.get("WWW-Authenticate")).toBe(
      'Basic realm="homelab-reader OPDS"',
    );
  });
});

describe("GET /api/opds/progress — request validation", () => {
  it("missing bookId -> 400", async () => {
    const { GET } = await import("@/app/api/opds/progress/route");
    const res = await GET(opdsReq(TOKEN_A)); // no bookId query param
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("missing bookId");
  });
});

describe("GET /api/opds/progress — read behaviour", () => {
  it("valid token, no progress row -> the no-row shape { percent: 0, anchor: null }", async () => {
    const { GET } = await import("@/app/api/opds/progress/route");
    const res = await GET(opdsReq(TOKEN_A, seed.bookId));
    expect(res.status).toBe(200);
    const body = await res.json();
    // Mirrors the session GET /api/progress no-row shape exactly (no updatedAt).
    expect(body).toEqual({ percent: 0, anchor: null });
  });

  it("write-then-read symmetry: POST via the OPDS path, then GET returns the exact { percent, anchor, updatedAt }", async () => {
    const { POST, GET } = await import("@/app/api/opds/progress/route");
    const anchor = { type: "epub-cfi", cfi: "/6/4[chap01]!/4/2/2/1:0" };

    const postRes = await POST(
      new Request("http://t/api/opds/progress", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Basic ${Buffer.from(`u:${TOKEN_A}`).toString("base64")}`,
        },
        body: JSON.stringify({ bookId: seed.bookId, anchor, percent: 0.42 }),
      }),
    );
    expect(postRes.status).toBe(200);

    const getRes = await GET(opdsReq(TOKEN_A, seed.bookId));
    expect(getRes.status).toBe(200);
    const body = (await getRes.json()) as {
      percent: number;
      anchor: unknown;
      updatedAt: string;
    };
    expect(body.percent).toBe(0.42);
    expect(body.anchor).toEqual(anchor);
    // updatedAt is present and a parseable timestamp (Prisma @updatedAt).
    expect(typeof body.updatedAt).toBe("string");
    expect(Number.isNaN(Date.parse(body.updatedAt))).toBe(false);
    // Exact shape: only these three keys.
    expect(Object.keys(body).sort()).toEqual(
      ["anchor", "percent", "updatedAt"].sort(),
    );
  });

  it("cross-user isolation: B's token never sees A's progress", async () => {
    const { GET } = await import("@/app/api/opds/progress/route");
    // A already has a row for seed.bookId (seeded by the symmetry test above).
    // B reading the same book must get the no-row shape, not A's position.
    const res = await GET(opdsReq(TOKEN_B, seed.bookId));
    expect(res.status).toBe(200);
    const body = await res.json();
    // Implementation yields the no-row shape (it does NOT 404) — B simply has
    // no Progress row for this book, so { percent: 0, anchor: null } comes back.
    expect(body).toEqual({ percent: 0, anchor: null });
  });
});
