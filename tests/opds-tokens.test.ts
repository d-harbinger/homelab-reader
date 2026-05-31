// OPDS-01 / OPDS-04 — token-management REST against a REAL ephemeral SQLite DB.
//
// Prisma is NOT mocked for the data path (same rationale as isolation.test.ts):
// the point is to prove the real `where: { userId }` list filter and the
// `existing.userId !== userId -> 404` revoke ownership check genuinely block
// cross-user access, and that the mint/list shapes never leak the token or its
// hash. A mocked client would make those a tautology.
//
// Seam: vi.mock("@/lib/prisma") injects an ephemeral PrismaClient bound to a
// temp SQLite file, built in a vi.hoisted() block so it exists before the
// hoisted vi.mock factory runs. The committed migrations (incl. opds_tokens,
// generated on the host) are applied in beforeAll against that temp file.
// vi.mock("@/auth") lets the real getCurrentUserId logic run against a fake
// session, driven by asReader from the auth-mock helper.

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
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { PrismaClient } from "@prisma/client";

// --- hoisted: build the temp DB url + client before any module import -------
// vi.hoisted runs ABOVE the top-level imports, so it imports what it needs
// internally (resolution happens at call time) rather than using the
// not-yet-initialized top-level bindings.
const h = await vi.hoisted(async () => {
  const { mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const path = (await import("node:path")).default;
  const { PrismaClient } = await import("@prisma/client");
  const dir = mkdtempSync(path.join(tmpdir(), "hlr-tok-"));
  const dbFile = path.join(dir, "test.db");
  const url = `file:${dbFile}`;
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  return { dir, url, prisma };
});

// Inject the ephemeral client wherever the route handlers `import { prisma }`.
vi.mock("@/lib/prisma", () => ({ prisma: h.prisma }));
// Mock the auth seam; real getCurrentUserId logic runs against the fake session.
vi.mock("@/auth", () => ({ auth: vi.fn() }));

import { asReader, signOut } from "./helpers/auth-mock";

interface Seed {
  userA: string;
  userB: string;
}
let seed: Seed;
// A token owned by B that A must never be able to list or revoke.
let tokenOfB: { id: string; tokenHash: string };

const sha = (t: string) => createHash("sha256").update(t).digest("hex");

beforeAll(async () => {
  // Apply the committed migrations (incl. opds_tokens) to the throwaway file.
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
  const bRow = await h.prisma.opdsToken.create({
    data: { userId: b.id, tokenHash: sha("b-secret-token"), label: "b-phone" },
  });

  seed = { userA: a.id, userB: b.id };
  tokenOfB = { id: bRow.id, tokenHash: bRow.tokenHash };
});

afterAll(async () => {
  await h.prisma.$disconnect();
  rmSync(h.dir, { recursive: true, force: true });
});

beforeEach(() => {
  vi.clearAllMocks();
  asReader(seed.userA); // every test acts as user A unless it re-sets the session
});

const idCtx = (id: string) => ({ params: Promise.resolve({ id }) });

// ---------------------------------------------------------------------------
// Mint (POST) — plaintext token returned exactly once, hash stored, not plain.
// ---------------------------------------------------------------------------
describe("POST /api/opds-tokens — mint (OPDS-01/04)", () => {
  it("mints a labelled token, returns the plaintext ONCE, stores only the hash", async () => {
    const { POST } = await import("@/app/api/opds-tokens/route");
    const res = await POST(
      new Request("http://t/api/opds-tokens", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ label: "my-laptop" }),
      }),
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      id: string;
      label: string;
      createdAt: string;
      token: string;
      tokenHash?: string;
    };
    // Plaintext token present once; no hash field on the mint response.
    expect(typeof body.token).toBe("string");
    expect(body.token.length).toBeGreaterThan(0);
    expect(body.tokenHash).toBeUndefined();
    expect(body.label).toBe("my-laptop");

    // The stored row holds the SHA-256 of the returned plaintext — never the
    // plaintext itself.
    const row = await h.prisma.opdsToken.findUnique({ where: { id: body.id } });
    expect(row).not.toBeNull();
    expect(row?.userId).toBe(seed.userA);
    expect(row?.tokenHash).toBe(sha(body.token));
    // Defensive: the plaintext must not have been persisted in any column.
    expect(JSON.stringify(row)).not.toContain(body.token);
  });

  it("rejects a missing or blank label with 400", async () => {
    const { POST } = await import("@/app/api/opds-tokens/route");
    const blank = await POST(
      new Request("http://t/api/opds-tokens", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ label: "   " }),
      }),
    );
    expect(blank.status).toBe(400);
    const missing = await POST(
      new Request("http://t/api/opds-tokens", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      }),
    );
    expect(missing.status).toBe(400);
  });

  it("signed out -> 401", async () => {
    signOut();
    const { POST } = await import("@/app/api/opds-tokens/route");
    const res = await POST(
      new Request("http://t/api/opds-tokens", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ label: "x" }),
      }),
    );
    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// List (GET) — caller's own tokens only, never the token or hash.
// ---------------------------------------------------------------------------
describe("GET /api/opds-tokens — list (OPDS-04 disclosure)", () => {
  it("returns the caller's tokens with no token and no tokenHash", async () => {
    const { GET } = await import("@/app/api/opds-tokens/route");
    const res = await GET();
    expect(res.status).toBe(200);
    const { tokens } = (await res.json()) as {
      tokens: Array<Record<string, unknown>>;
    };
    expect(Array.isArray(tokens)).toBe(true);
    // None of A's rows is B's token, and no row carries secret material.
    expect(tokens.find((t) => t.id === tokenOfB.id)).toBeUndefined();
    for (const t of tokens) {
      expect(t.tokenHash).toBeUndefined();
      expect(t.token).toBeUndefined();
      expect(Object.keys(t).sort()).toEqual(
        ["createdAt", "id", "label", "lastUsedAt"].sort(),
      );
    }
    // Defensive: B's hash must not appear anywhere in A's serialized list.
    expect(JSON.stringify(tokens)).not.toContain(tokenOfB.tokenHash);
  });

  it("signed out -> 401", async () => {
    signOut();
    const { GET } = await import("@/app/api/opds-tokens/route");
    const res = await GET();
    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// Revoke (DELETE) — own token deletes; another user's token -> 404 + survives.
// ---------------------------------------------------------------------------
describe("DELETE /api/opds-tokens/[id] — per-user revoke (OPDS-01, T-02-06)", () => {
  it("deletes the caller's own token (204, row gone)", async () => {
    const mine = await h.prisma.opdsToken.create({
      data: { userId: seed.userA, tokenHash: sha("a-own-token"), label: "a-own" },
    });
    const { DELETE } = await import("@/app/api/opds-tokens/[id]/route");
    const res = await DELETE(
      new Request(`http://t/api/opds-tokens/${mine.id}`, { method: "DELETE" }),
      idCtx(mine.id),
    );
    expect(res.status).toBe(204);
    expect(
      await h.prisma.opdsToken.findUnique({ where: { id: mine.id } }),
    ).toBeNull();
  });

  it("A cannot revoke B's token -> 404 and B's row survives", async () => {
    const { DELETE } = await import("@/app/api/opds-tokens/[id]/route");
    const res = await DELETE(
      new Request(`http://t/api/opds-tokens/${tokenOfB.id}`, {
        method: "DELETE",
      }),
      idCtx(tokenOfB.id),
    );
    expect(res.status).toBe(404);
    expect(
      await h.prisma.opdsToken.findUnique({ where: { id: tokenOfB.id } }),
    ).not.toBeNull();
  });

  it("unknown id -> 404", async () => {
    const { DELETE } = await import("@/app/api/opds-tokens/[id]/route");
    const res = await DELETE(
      new Request("http://t/api/opds-tokens/does-not-exist", {
        method: "DELETE",
      }),
      idCtx("does-not-exist"),
    );
    expect(res.status).toBe(404);
  });

  it("signed out -> 401", async () => {
    signOut();
    const { DELETE } = await import("@/app/api/opds-tokens/[id]/route");
    const res = await DELETE(
      new Request(`http://t/api/opds-tokens/${tokenOfB.id}`, {
        method: "DELETE",
      }),
      idCtx(tokenOfB.id),
    );
    expect(res.status).toBe(401);
  });
});
