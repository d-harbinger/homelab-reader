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
import { tokenExpiry, TOKEN_LIFETIME_DAYS } from "@/lib/opds-auth";
import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import { createHash } from "node:crypto";

// --- hoisted: build the temp DB url + client before any module import -------
// vi.hoisted runs ABOVE the top-level imports, so it imports what it needs
// internally (resolution happens at call time) rather than using the
// not-yet-initialized top-level bindings.
const h = await vi.hoisted(async () => {
  const { mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const path = (await import("node:path")).default;
  const { PrismaClient } = await import("@prisma/client");
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
    data: { userId: a.id, tokenHash: sha(TOKEN_A), label: "alice-laptop", expiresAt: tokenExpiry() },
  });
  await h.prisma.opdsToken.create({
    data: { userId: b.id, tokenHash: sha(TOKEN_B), label: "bob-phone", expiresAt: tokenExpiry() },
  });
  await h.prisma.opdsToken.create({
    data: { userId: a.id, tokenHash: sha(TOKEN_WITH_COLON), label: "alice-colon", expiresAt: tokenExpiry() },
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

// ---------------------------------------------------------------------------
// Route-level enforcement: every OPDS GET 401s without a valid token and
// returns the feed with one (OPDS-01/02). Handlers are imported dynamically so
// the hoisted vi.mock("@/lib/prisma") is already in place.
// ---------------------------------------------------------------------------
const OPDS_ROUTES = [
  { name: "/api/opds", mod: "@/app/api/opds/route", url: "http://t/api/opds" },
  { name: "/api/opds/all", mod: "@/app/api/opds/all/route", url: "http://t/api/opds/all" },
  {
    name: "/api/opds/recent",
    mod: "@/app/api/opds/recent/route",
    url: "http://t/api/opds/recent",
  },
] as const;

describe("OPDS routes — unauthenticated -> 401 + challenge (OPDS-02)", () => {
  for (const route of OPDS_ROUTES) {
    it(`${route.name} with no Authorization -> 401 + WWW-Authenticate`, async () => {
      const { GET } = (await import(route.mod)) as {
        GET: (req: Request) => Promise<Response>;
      };
      const res = await GET(new Request(route.url));
      expect(res.status).toBe(401);
      expect(res.headers.get("www-authenticate")).toBe(
        'Basic realm="homelab-reader OPDS"',
      );
    });

    it(`${route.name} with a wrong token -> 401, not the feed`, async () => {
      const { GET } = (await import(route.mod)) as {
        GET: (req: Request) => Promise<Response>;
      };
      const res = await GET(
        new Request(route.url, {
          headers: { Authorization: bearer("totally-wrong") },
        }),
      );
      expect(res.status).toBe(401);
    });
  }
});

describe("OPDS routes — valid token -> 200 + feed (OPDS-01)", () => {
  it("/api/opds with valid Basic -> 200 + OPDS feed root", async () => {
    const { GET } = (await import("@/app/api/opds/route")) as {
      GET: (req: Request) => Promise<Response>;
    };
    const res = await GET(
      new Request("http://t/api/opds", {
        headers: { Authorization: basic("alice", TOKEN_A) },
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("<feed");
  });

  it("/api/opds with valid Bearer -> 200", async () => {
    const { GET } = (await import("@/app/api/opds/route")) as {
      GET: (req: Request) => Promise<Response>;
    };
    const res = await GET(
      new Request("http://t/api/opds", {
        headers: { Authorization: bearer(TOKEN_A) },
      }),
    );
    expect(res.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// Progress attribution: a POST over the OPDS path lands on the TOKEN OWNER's
// Progress row, never anonymously and never another user (OPDS-03, T-02-04).
// ---------------------------------------------------------------------------
describe("OPDS progress write attributed to the token owner (OPDS-03)", () => {
  it("POST /api/opds/progress with Alice's token writes Alice's row", async () => {
    const { POST } = (await import("@/app/api/opds/progress/route")) as {
      POST: (req: Request) => Promise<Response>;
    };
    const res = await POST(
      new Request("http://t/api/opds/progress", {
        method: "POST",
        headers: {
          Authorization: basic("alice", TOKEN_A),
          "content-type": "application/json",
        },
        body: JSON.stringify({
          bookId: seed.bookId,
          anchor: { type: "epub-cfi", cfi: "/6/4" },
          percent: 1.5, // out of range on purpose -> must clamp to 1
        }),
      }),
    );
    expect(res.status).toBe(200);

    const row = await h.prisma.progress.findUnique({
      where: { bookId_userId: { bookId: seed.bookId, userId: seed.userA } },
    });
    expect(row).not.toBeNull();
    expect(row?.userId).toBe(seed.userA);
    expect(row?.percent).toBe(1); // clamped 0..1

    // And NOT attributed to Bob.
    const bobRow = await h.prisma.progress.findUnique({
      where: { bookId_userId: { bookId: seed.bookId, userId: seed.userB } },
    });
    expect(bobRow).toBeNull();
  });

  it("POST /api/opds/progress with no token -> 401, no row written", async () => {
    const { POST } = (await import("@/app/api/opds/progress/route")) as {
      POST: (req: Request) => Promise<Response>;
    };
    // Use a fresh book so we can assert nothing was written for it.
    const book = await h.prisma.book.create({
      data: { filePath: "/seed/unauth.epub", format: "epub", title: "Unauth" },
    });
    const res = await POST(
      new Request("http://t/api/opds/progress", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          bookId: book.id,
          anchor: { type: "epub-cfi", cfi: "/6/2" },
          percent: 0.3,
        }),
      }),
    );
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toBe(
      'Basic realm="homelab-reader OPDS"',
    );
    const count = await h.prisma.progress.count({ where: { bookId: book.id } });
    expect(count).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Expiry — the half of the lifecycle that does not depend on anyone noticing.
// ---------------------------------------------------------------------------
//
// These tokens are password-equivalent and live on a phone. Revocation already
// worked, but revocation only helps the person who remembers to use it, and the
// usual fate of a token on a lost or replaced handset is to be forgotten. The
// column is NOT NULL (prisma/schema.prisma) so "never expires" is not a state
// the database can hold; the guard enforces the date it names.
describe("token expiry", () => {
  const EXPIRED = "expired-token-value-abc123";
  const FRESH = "fresh-token-value-xyz789";

  beforeAll(async () => {
    await h.prisma.opdsToken.create({
      data: {
        userId: seed.userA,
        tokenHash: sha(EXPIRED),
        label: "an old phone",
        expiresAt: new Date(Date.now() - 60_000),
      },
    });
    await h.prisma.opdsToken.create({
      data: {
        userId: seed.userA,
        tokenHash: sha(FRESH),
        label: "the current phone",
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
  });

  it("refuses an expired token", async () => {
    expect(await authenticateOpds(reqWith(bearer(EXPIRED)))).toBeNull();
    expect(await authenticateOpds(reqWith(basic("alice", EXPIRED)))).toBeNull();
  });

  it("accepts a token that has not expired yet", async () => {
    const user = await authenticateOpds(reqWith(bearer(FRESH)));
    expect(user?.id).toBe(seed.userA);
  });

  it("is indistinguishable from an unknown token on the wire", async () => {
    // An expired credential must not be confirmable as "real, just old" — that
    // tells a stranger holding it that it is worth attacking the clock or the
    // account. Both cases produce the same null, and the same 401 above it.
    const expired = await authenticateOpds(reqWith(bearer(EXPIRED)));
    const nonsense = await authenticateOpds(reqWith(bearer("no-such-token")));
    expect(expired).toEqual(nonsense);
  });

  it("stamps a finite lifetime, which is what the mint uses", async () => {
    // tokenExpiry() is the single expression the mint route calls, so pinning
    // it here pins what every new token gets. (The route itself is cookie-gated
    // and covered in tests/opds-tokens.test.ts.)
    expect(TOKEN_LIFETIME_DAYS).toBe(90);
    expect(tokenExpiry(new Date("2026-01-01T00:00:00Z")).toISOString()).toBe(
      "2026-04-01T00:00:00.000Z",
    );
  });
});
