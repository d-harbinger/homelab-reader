// OPDS-01..04 — per-user OPDS token auth against a REAL ephemeral SQLite DB.
//
// Prisma is NOT mocked for the data path (same rationale as isolation.test.ts):
// the point is to prove the real tokenHash lookup + constant-time confirm
// genuinely accept the right token and reject everything else. A mocked client
// would make those a tautology.
//
// Seam: vi.mock("@/lib/prisma") injects an ephemeral PrismaClient bound to a
// temp SQLite file, constructed in a vi.hoisted() block so it exists before the
// hoisted vi.mock factory runs. Committed migrations are applied in beforeAll
// against that same temp file — including the OpdsToken table from the
// opds_tokens migration generated on the host.
//
// The guard drives the Authorization header directly; no cookie session is
// involved (OPDS is deliberately middleware-exempt and authenticates in-route).

import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  vi,
} from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { PrismaClient } from "@prisma/client";

// --- hoisted: build the temp DB url + client before any module import -------
const h = vi.hoisted(() => {
  const dir = mkdtempSync(path.join(tmpdir(), "hlr-opds-"));
  const dbFile = path.join(dir, "test.db");
  const url = `file:${dbFile}`;
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  return { dir, url, prisma };
});

// Inject the ephemeral client wherever route handlers / the guard
// `import { prisma }`.
vi.mock("@/lib/prisma", () => ({ prisma: h.prisma }));

import { authenticateOpds, opdsChallenge } from "@/lib/opds-auth";

// Known plaintext tokens and their SHA-256 hex (what the guard looks up by).
const TOKEN_A = "alice-token-AbC123_base64url";
const TOKEN_B = "bob-token-XyZ789_base64url";
const TOKEN_WITH_COLON = "weird:token:with:colons";
const sha = (t: string) => createHash("sha256").update(t).digest("hex");

interface Seed {
  userA: string;
  userB: string;
  bookId: string;
}
let seed: Seed;

beforeAll(async () => {
  // Apply the committed migrations (incl. opds_tokens) to the throwaway file.
  execFileSync("npx", ["prisma", "migrate", "deploy"], {
    env: { ...process.env, DATABASE_URL: h.url },
    stdio: "inherit",
  });

  const a = await h.prisma.user.create({
    data: { username: "alice", passwordHash: "x", role: "reader" },
  });
  const b = await h.prisma.user.create({
    data: { username: "bob", passwordHash: "x", role: "reader" },
  });
  const book = await h.prisma.book.create({
    data: { filePath: "/seed/opds.epub", format: "epub", title: "OPDS Seed" },
  });

  // Alice's token, Bob's token, and a token whose plaintext contains colons
  // (owned by Alice) to prove the first-colon Basic split keeps the token whole.
  await h.prisma.opdsToken.create({
    data: { userId: a.id, tokenHash: sha(TOKEN_A), label: "alice-laptop" },
  });
  await h.prisma.opdsToken.create({
    data: { userId: b.id, tokenHash: sha(TOKEN_B), label: "bob-phone" },
  });
  await h.prisma.opdsToken.create({
    data: { userId: a.id, tokenHash: sha(TOKEN_WITH_COLON), label: "alice-colon" },
  });

  seed = { userA: a.id, userB: b.id, bookId: book.id };
});

afterAll(async () => {
  await h.prisma.$disconnect();
  rmSync(h.dir, { recursive: true, force: true });
});

// Build an Authorization header value for the two accepted schemes.
const basic = (user: string, token: string) =>
  "Basic " + Buffer.from(`${user}:${token}`).toString("base64");
const bearer = (token: string) => "Bearer " + token;
const reqWith = (auth?: string) =>
  new Request("http://t/api/opds", auth ? { headers: { Authorization: auth } } : {});

// ---------------------------------------------------------------------------
// authenticateOpds guard (OPDS-01, OPDS-04 core)
// ---------------------------------------------------------------------------
describe("authenticateOpds — token accept/reject (OPDS-01/04)", () => {
  it("no Authorization header -> null", async () => {
    expect(await authenticateOpds(reqWith())).toBeNull();
  });

  it("valid Basic credential -> the owning user", async () => {
    const user = await authenticateOpds(reqWith(basic("alice", TOKEN_A)));
    expect(user?.id).toBe(seed.userA);
  });

  it("valid Bearer credential -> the owning user", async () => {
    const user = await authenticateOpds(reqWith(bearer(TOKEN_A)));
    expect(user?.id).toBe(seed.userA);
  });

  it("Bearer resolves the owner from the token alone (no username)", async () => {
    const user = await authenticateOpds(reqWith(bearer(TOKEN_B)));
    expect(user?.id).toBe(seed.userB);
  });

  it("wrong/unknown token -> null", async () => {
    expect(
      await authenticateOpds(reqWith(basic("alice", "not-a-real-token"))),
    ).toBeNull();
    expect(await authenticateOpds(reqWith(bearer("nope")))).toBeNull();
  });

  it("malformed scheme (Digest) -> null", async () => {
    expect(await authenticateOpds(reqWith("Digest x"))).toBeNull();
  });

  it("Basic with no colon in the decoded credential -> null", async () => {
    const bad = "Basic " + Buffer.from("noseparator").toString("base64");
    expect(await authenticateOpds(reqWith(bad))).toBeNull();
  });

  it("token containing colons survives the first-colon Basic split", async () => {
    // base64("alice:weird:token:with:colons") — the username is "alice", the
    // token is everything after the first colon, colons intact.
    const user = await authenticateOpds(
      reqWith(basic("alice", TOKEN_WITH_COLON)),
    );
    expect(user?.id).toBe(seed.userA);
  });
});

// ---------------------------------------------------------------------------
// opdsChallenge helper (OPDS-02)
// ---------------------------------------------------------------------------
describe("opdsChallenge — 401 + WWW-Authenticate (OPDS-02)", () => {
  it("returns 401 with the contract's exact realm header", () => {
    const res = opdsChallenge();
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toBe(
      'Basic realm="homelab-reader OPDS"',
    );
  });
});
