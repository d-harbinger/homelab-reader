// S2 — token-reachable highlight routes under /api/opds/highlights(/[id]).
//
// Prisma is NOT mocked for the data path (same rationale as opds-progress-get,
// opds-tokens, and isolation): the point is to prove the REAL per-user
// `where: { userId }` scoping and the `existing.userId !== userId -> 404`
// ownership check genuinely isolate one account's highlights from another's over
// the OPDS token path — a mocked client would make that a tautology. The shared
// annotations lib body is the same code the cookie-session route runs, so this
// suite also proves the extraction preserved validation and shapes.
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
  const dir = mkdtempSync(path.join(tmpdir(), "hlr-opds-hl-"));
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
  highlightOfB: string; // a highlight owned by user B, for cross-user 404 checks
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
  return new Request(`http://t/api/opds/highlights${qs}`, { headers });
}

function postReq(token: string | null, body: unknown): Request {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (token !== null) Object.assign(headers, auth(token));
  return new Request("http://t/api/opds/highlights", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

function idReq(
  token: string | null,
  id: string,
  method: "PATCH" | "DELETE",
  body?: unknown,
): Request {
  const headers: Record<string, string> = {};
  if (method === "PATCH") headers["content-type"] = "application/json";
  if (token !== null) Object.assign(headers, auth(token));
  return new Request(`http://t/api/opds/highlights/${id}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const idCtx = (id: string) => ({ params: Promise.resolve({ id }) });

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
  const hlB = await h.prisma.highlight.create({
    data: {
      bookId: book.id,
      userId: b.id,
      anchor: JSON.stringify({ type: "epub-cfi-range", cfi: "/6/8" }),
      text: "B's highlight",
      color: "green",
    },
  });

  seed = { bookId: book.id, highlightOfB: hlB.id };
});

afterAll(async () => {
  await h.prisma.$disconnect();
  rmSync(h.dir, { recursive: true, force: true });
});

const CHALLENGE = 'Basic realm="homelab-reader OPDS"';

describe("/api/opds/highlights — auth guard", () => {
  it("GET no Authorization header -> 401 with the pinned WWW-Authenticate challenge", async () => {
    const { GET } = await import("@/app/api/opds/highlights/route");
    const res = await GET(getReq(null, seed.bookId));
    expect(res.status).toBe(401);
    expect(res.headers.get("WWW-Authenticate")).toBe(CHALLENGE);
  });

  it("POST invalid/unknown token -> 401 with the challenge", async () => {
    const { POST } = await import("@/app/api/opds/highlights/route");
    const res = await POST(postReq("not-a-real-token", { bookId: seed.bookId }));
    expect(res.status).toBe(401);
    expect(res.headers.get("WWW-Authenticate")).toBe(CHALLENGE);
  });

  it("PATCH [id] missing token -> 401", async () => {
    const { PATCH } = await import("@/app/api/opds/highlights/[id]/route");
    const res = await PATCH(idReq(null, "any", "PATCH", { color: "blue" }), idCtx("any"));
    expect(res.status).toBe(401);
  });

  it("DELETE [id] missing token -> 401", async () => {
    const { DELETE } = await import("@/app/api/opds/highlights/[id]/route");
    const res = await DELETE(idReq(null, "any", "DELETE"), idCtx("any"));
    expect(res.status).toBe(401);
  });
});

describe("/api/opds/highlights — request validation", () => {
  it("GET missing bookId -> 400", async () => {
    const { GET } = await import("@/app/api/opds/highlights/route");
    const res = await GET(getReq(TOKEN_A));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("missing bookId");
  });

  it("POST missing bookId/anchor/text -> 400", async () => {
    const { POST } = await import("@/app/api/opds/highlights/route");
    const res = await POST(postReq(TOKEN_A, { bookId: seed.bookId }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("missing bookId, anchor, or text");
  });

  it("POST unknown color -> 400", async () => {
    const { POST } = await import("@/app/api/opds/highlights/route");
    const res = await POST(
      postReq(TOKEN_A, {
        bookId: seed.bookId,
        anchor: { type: "epub-cfi-range", cfi: "/6/2" },
        text: "hi",
        color: "chartreuse",
      }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid color");
  });

  it("POST unknown book -> 404", async () => {
    const { POST } = await import("@/app/api/opds/highlights/route");
    const res = await POST(
      postReq(TOKEN_A, {
        bookId: "no-such-book",
        anchor: { type: "epub-cfi-range", cfi: "/6/2" },
        text: "hi",
      }),
    );
    expect(res.status).toBe(404);
  });
});

describe("/api/opds/highlights — CRUD over the token path", () => {
  it("POST creates, then GET lists it (write→read round-trip)", async () => {
    const { POST, GET } = await import("@/app/api/opds/highlights/route");
    const anchor = { type: "epub-cfi-range", cfi: "/6/4[chap01]!/4/2" };
    const postRes = await POST(
      postReq(TOKEN_A, { bookId: seed.bookId, anchor, text: "note text", color: "blue" }),
    );
    expect(postRes.status).toBe(200);
    const created = (await postRes.json()) as {
      id: string;
      color: string;
      text: string;
      anchor: unknown;
    };
    expect(created.color).toBe("blue");
    expect(created.text).toBe("note text");
    expect(created.anchor).toEqual(anchor);

    const getRes = await GET(getReq(TOKEN_A, seed.bookId));
    expect(getRes.status).toBe(200);
    const { highlights } = (await getRes.json()) as {
      highlights: { id: string; color: string }[];
    };
    const found = highlights.find((x) => x.id === created.id);
    expect(found).toBeDefined();
    expect(found?.color).toBe("blue");
  });

  it("PATCH changes color, DELETE returns 204 then the row is gone", async () => {
    const { POST } = await import("@/app/api/opds/highlights/route");
    const { PATCH, DELETE } = await import("@/app/api/opds/highlights/[id]/route");

    const created = (await (
      await POST(
        postReq(TOKEN_A, {
          bookId: seed.bookId,
          anchor: { type: "epub-cfi-range", cfi: "/6/6" },
          text: "to be recolored",
        }),
      )
    ).json()) as { id: string; color: string };
    expect(created.color).toBe("yellow"); // default

    const patchRes = await PATCH(
      idReq(TOKEN_A, created.id, "PATCH", { color: "pink" }),
      idCtx(created.id),
    );
    expect(patchRes.status).toBe(200);
    expect((await patchRes.json()).color).toBe("pink");

    const delRes = await DELETE(idReq(TOKEN_A, created.id, "DELETE"), idCtx(created.id));
    expect(delRes.status).toBe(204);
    expect(
      await h.prisma.highlight.findUnique({ where: { id: created.id } }),
    ).toBeNull();
  });
});

describe("/api/opds/highlights — cross-user isolation", () => {
  it("A's token GET never returns B's highlight", async () => {
    const { GET } = await import("@/app/api/opds/highlights/route");
    const res = await GET(getReq(TOKEN_A, seed.bookId));
    const { highlights } = (await res.json()) as { highlights: { id: string }[] };
    expect(highlights.find((x) => x.id === seed.highlightOfB)).toBeUndefined();
  });

  it("A's token cannot PATCH B's highlight -> 404, B's row unchanged", async () => {
    const { PATCH } = await import("@/app/api/opds/highlights/[id]/route");
    const res = await PATCH(
      idReq(TOKEN_A, seed.highlightOfB, "PATCH", { color: "red" }),
      idCtx(seed.highlightOfB),
    );
    expect(res.status).toBe(404);
    const row = await h.prisma.highlight.findUnique({
      where: { id: seed.highlightOfB },
    });
    expect(row?.color).toBe("green"); // unchanged
  });

  it("A's token cannot DELETE B's highlight -> 404, B's row survives", async () => {
    const { DELETE } = await import("@/app/api/opds/highlights/[id]/route");
    const res = await DELETE(
      idReq(TOKEN_A, seed.highlightOfB, "DELETE"),
      idCtx(seed.highlightOfB),
    );
    expect(res.status).toBe(404);
    expect(
      await h.prisma.highlight.findUnique({ where: { id: seed.highlightOfB } }),
    ).not.toBeNull();
  });
});
