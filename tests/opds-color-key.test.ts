// S1 — token-reachable highlight color-key routes under /api/opds/highlight-key.
//
// Prisma is NOT mocked for the data path (same rationale as opds-highlights,
// opds-progress-get, and isolation): the point is to prove the REAL per-user
// `where: { userId }` scoping genuinely isolates one account's color key from
// another's over the OPDS token path — a mocked client would make that a
// tautology. The shared annotations lib body is the same code the cookie-session
// route runs, so this suite also proves the token front door preserves the
// validation and shapes.
//
// Seam: vi.mock("@/lib/prisma") injects an ephemeral PrismaClient bound to a
// temp SQLite file, built in a vi.hoisted() block so it exists before the
// hoisted vi.mock factory runs. The committed migrations are applied in
// beforeAll. There is NO @/auth mock — the OPDS path authenticates on the
// Authorization header via a real prisma.opdsToken lookup, not the cookie session.

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { tokenExpiry } from "@/lib/opds-auth";
import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import { createHash } from "node:crypto";

const h = await vi.hoisted(async () => {
  const { mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const path = (await import("node:path")).default;
  const { PrismaClient } = await import("@prisma/client");
  const dir = mkdtempSync(path.join(tmpdir(), "hlr-opds-ck-"));
  const dbFile = path.join(dir, "test.db");
  const url = `file:${dbFile}`;
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  return { dir, url, prisma };
});

vi.mock("@/lib/prisma", () => ({ prisma: h.prisma }));

const sha = (t: string) => createHash("sha256").update(t).digest("hex");

// Synthetic fixtures only — no real hostnames, IPs, usernames, or tokens.
const TOKEN_A = "token-alpha-synthetic";
const TOKEN_B = "token-bravo-synthetic";

interface Seed {
  bookId: string;
}
let seed: Seed;

// The Basic credential the OPDS guard accepts: base64("username:token"), token
// after the first colon. A null token means "send no Authorization header".
function auth(token: string): Record<string, string> {
  const cred = Buffer.from(`ignored-username:${token}`).toString("base64");
  return { authorization: `Basic ${cred}` };
}

function getReq(token: string | null, bookId?: string): Request {
  const qs = bookId === undefined ? "" : `?bookId=${encodeURIComponent(bookId)}`;
  const headers = token === null ? {} : auth(token);
  return new Request(`http://t/api/opds/highlight-key${qs}`, { headers });
}

function putReq(token: string | null, body: unknown): Request {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (token !== null) Object.assign(headers, auth(token));
  return new Request("http://t/api/opds/highlight-key", {
    method: "PUT",
    headers,
    body: JSON.stringify(body),
  });
}

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
  await h.prisma.opdsToken.create({
    data: { userId: a.id, tokenHash: sha(TOKEN_A), label: "a-device", expiresAt: tokenExpiry() },
  });
  await h.prisma.opdsToken.create({
    data: { userId: b.id, tokenHash: sha(TOKEN_B), label: "b-device", expiresAt: tokenExpiry() },
  });
  const book = await h.prisma.book.create({
    data: { title: "Synthetic Title", format: "epub", filePath: "/synthetic.epub" },
  });

  seed = { bookId: book.id };
});

afterAll(async () => {
  await h.prisma.$disconnect();
  rmSync(h.dir, { recursive: true, force: true });
});

const CHALLENGE = 'Basic realm="homelab-reader OPDS"';

describe("/api/opds/highlight-key — auth guard", () => {
  it("GET no Authorization header -> 401 with the pinned WWW-Authenticate challenge", async () => {
    const { GET } = await import("@/app/api/opds/highlight-key/route");
    const res = await GET(getReq(null, seed.bookId));
    expect(res.status).toBe(401);
    expect(res.headers.get("WWW-Authenticate")).toBe(CHALLENGE);
  });

  it("PUT invalid/unknown token -> 401 with the challenge", async () => {
    const { PUT } = await import("@/app/api/opds/highlight-key/route");
    const res = await PUT(
      putReq("not-a-real-token", {
        bookId: seed.bookId,
        color: "yellow",
        label: "x",
      }),
    );
    expect(res.status).toBe(401);
    expect(res.headers.get("WWW-Authenticate")).toBe(CHALLENGE);
  });
});

describe("/api/opds/highlight-key — CRUD over the token path", () => {
  it("PUT upserts a color's label, then GET returns the token owner's map", async () => {
    const { GET, PUT } = await import("@/app/api/opds/highlight-key/route");

    const putRes = await PUT(
      putReq(TOKEN_A, { bookId: seed.bookId, color: "yellow", label: "Key terms" }),
    );
    expect(putRes.status).toBe(200);
    expect(await putRes.json()).toEqual({ key: { yellow: "Key terms" } });

    const getRes = await GET(getReq(TOKEN_A, seed.bookId));
    expect(getRes.status).toBe(200);
    expect(await getRes.json()).toEqual({ key: { yellow: "Key terms" } });
  });

  it("PUT with an empty label clears the entry", async () => {
    const { GET, PUT } = await import("@/app/api/opds/highlight-key/route");

    await PUT(putReq(TOKEN_A, { bookId: seed.bookId, color: "blue", label: "Orgs" }));
    const clearRes = await PUT(
      putReq(TOKEN_A, { bookId: seed.bookId, color: "blue", label: "  " }),
    );
    expect(clearRes.status).toBe(200);
    const { key } = (await clearRes.json()) as { key: Record<string, string> };
    expect(key.blue).toBeUndefined();

    const getRes = await GET(getReq(TOKEN_A, seed.bookId));
    const after = (await getRes.json()) as { key: Record<string, string> };
    expect(after.key.blue).toBeUndefined();
  });
});

describe("/api/opds/highlight-key — cross-user isolation", () => {
  it("two tokens keep separate keys on the same book", async () => {
    const { GET, PUT } = await import("@/app/api/opds/highlight-key/route");

    await PUT(putReq(TOKEN_A, { bookId: seed.bookId, color: "pink", label: "A-only" }));
    await PUT(putReq(TOKEN_B, { bookId: seed.bookId, color: "pink", label: "B-only" }));

    const aRes = await GET(getReq(TOKEN_A, seed.bookId));
    const aKey = (await aRes.json()) as { key: Record<string, string> };
    expect(aKey.key.pink).toBe("A-only");

    const bRes = await GET(getReq(TOKEN_B, seed.bookId));
    const bKey = (await bRes.json()) as { key: Record<string, string> };
    expect(bKey.key.pink).toBe("B-only");
  });
});
