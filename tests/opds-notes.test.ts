// S2 — token-reachable note routes under /api/opds/notes(/[id]).
//
// Prisma is NOT mocked for the data path (same rationale as opds-progress-get,
// opds-tokens, and isolation): the real per-user `where: { userId }` scoping,
// the `existing.userId !== userId -> 404` ownership check, AND the optional
// highlightId ownership-404 all need a real DB to prove — a mocked client would
// make them tautologies. The shared annotations lib body is the same code the
// cookie-session route runs, so this suite also proves the extraction preserved
// validation, the highlightId binding rule, and response shapes.
//
// Seam: vi.mock("@/lib/prisma") injects an ephemeral PrismaClient bound to a
// temp SQLite file, built in a vi.hoisted() block. Migrations applied in
// beforeAll. No @/auth mock — the OPDS path authenticates on the Authorization
// header via a real prisma.opdsToken lookup, not the cookie session.

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import { createHash } from "node:crypto";

const h = await vi.hoisted(async () => {
  const { mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const path = (await import("node:path")).default;
  const { PrismaClient } = await import("@prisma/client");
  const dir = mkdtempSync(path.join(tmpdir(), "hlr-opds-notes-"));
  const dbFile = path.join(dir, "test.db");
  const url = `file:${dbFile}`;
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  return { dir, url, prisma };
});

vi.mock("@/lib/prisma", () => ({ prisma: h.prisma }));

const sha = (t: string) => createHash("sha256").update(t).digest("hex");

const TOKEN_A = "token-alpha-synthetic";
const TOKEN_B = "token-bravo-synthetic";

interface Seed {
  bookId: string;
  highlightOfA: string; // A's own highlight — valid binding target
  highlightOfB: string; // B's highlight — must be rejected when A binds to it
  noteOfB: string; // B's note — cross-user by-id target
}
let seed: Seed;

function auth(token: string): Record<string, string> {
  const cred = Buffer.from(`ignored-username:${token}`).toString("base64");
  return { authorization: `Basic ${cred}` };
}

function getReq(token: string | null, bookId?: string): Request {
  const qs = bookId === undefined ? "" : `?bookId=${encodeURIComponent(bookId)}`;
  const headers = token === null ? {} : auth(token);
  return new Request(`http://t/api/opds/notes${qs}`, { headers });
}

function postReq(token: string | null, body: unknown): Request {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (token !== null) Object.assign(headers, auth(token));
  return new Request("http://t/api/opds/notes", {
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
  return new Request(`http://t/api/opds/notes/${id}`, {
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
    data: { userId: a.id, tokenHash: sha(TOKEN_A), label: "a-device" },
  });
  await h.prisma.opdsToken.create({
    data: { userId: b.id, tokenHash: sha(TOKEN_B), label: "b-device" },
  });
  const book = await h.prisma.book.create({
    data: { title: "Synthetic Title", format: "epub", filePath: "/synthetic.epub" },
  });
  const hlA = await h.prisma.highlight.create({
    data: {
      bookId: book.id,
      userId: a.id,
      anchor: JSON.stringify({ type: "epub-cfi-range", cfi: "/6/2" }),
      text: "A's highlight",
      color: "yellow",
    },
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
  const noteB = await h.prisma.note.create({
    data: {
      bookId: book.id,
      userId: b.id,
      anchor: JSON.stringify({ type: "epub-cfi", cfi: "/6/8" }),
      body: "B's private note",
    },
  });

  seed = {
    bookId: book.id,
    highlightOfA: hlA.id,
    highlightOfB: hlB.id,
    noteOfB: noteB.id,
  };
});

afterAll(async () => {
  await h.prisma.$disconnect();
  rmSync(h.dir, { recursive: true, force: true });
});

const CHALLENGE = 'Basic realm="homelab-reader OPDS"';

describe("/api/opds/notes — auth guard", () => {
  it("GET no Authorization header -> 401 with the pinned WWW-Authenticate challenge", async () => {
    const { GET } = await import("@/app/api/opds/notes/route");
    const res = await GET(getReq(null, seed.bookId));
    expect(res.status).toBe(401);
    expect(res.headers.get("WWW-Authenticate")).toBe(CHALLENGE);
  });

  it("POST invalid/unknown token -> 401 with the challenge", async () => {
    const { POST } = await import("@/app/api/opds/notes/route");
    const res = await POST(postReq("not-a-real-token", { bookId: seed.bookId }));
    expect(res.status).toBe(401);
    expect(res.headers.get("WWW-Authenticate")).toBe(CHALLENGE);
  });

  it("PATCH [id] missing token -> 401", async () => {
    const { PATCH } = await import("@/app/api/opds/notes/[id]/route");
    const res = await PATCH(idReq(null, "any", "PATCH", { body: "x" }), idCtx("any"));
    expect(res.status).toBe(401);
  });

  it("DELETE [id] missing token -> 401", async () => {
    const { DELETE } = await import("@/app/api/opds/notes/[id]/route");
    const res = await DELETE(idReq(null, "any", "DELETE"), idCtx("any"));
    expect(res.status).toBe(401);
  });
});

describe("/api/opds/notes — request validation", () => {
  it("GET missing bookId -> 400", async () => {
    const { GET } = await import("@/app/api/opds/notes/route");
    const res = await GET(getReq(TOKEN_A));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("missing bookId");
  });

  it("POST missing bookId/anchor/body -> 400", async () => {
    const { POST } = await import("@/app/api/opds/notes/route");
    const res = await POST(postReq(TOKEN_A, { bookId: seed.bookId }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("missing bookId, anchor, or body");
  });

  it("POST unknown book -> 404", async () => {
    const { POST } = await import("@/app/api/opds/notes/route");
    const res = await POST(
      postReq(TOKEN_A, {
        bookId: "no-such-book",
        anchor: { type: "epub-cfi", cfi: "/6/2" },
        body: "hi",
      }),
    );
    expect(res.status).toBe(404);
  });
});

describe("/api/opds/notes — highlightId ownership binding", () => {
  it("POST binding A's OWN highlight -> 200, returns the highlightId", async () => {
    const { POST } = await import("@/app/api/opds/notes/route");
    const res = await POST(
      postReq(TOKEN_A, {
        bookId: seed.bookId,
        anchor: { type: "epub-cfi", cfi: "/6/2" },
        body: "bound note",
        highlightId: seed.highlightOfA,
      }),
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as { id: string; highlightId: string | null };
    expect(json.highlightId).toBe(seed.highlightOfA);
    await h.prisma.note.delete({ where: { id: json.id } });
  });

  it("POST binding ANOTHER user's highlight -> 404, no note created", async () => {
    const { POST } = await import("@/app/api/opds/notes/route");
    const before = await h.prisma.note.count();
    const res = await POST(
      postReq(TOKEN_A, {
        bookId: seed.bookId,
        anchor: { type: "epub-cfi", cfi: "/6/2" },
        body: "stolen-anchor note",
        highlightId: seed.highlightOfB, // owned by B, caller is A
      }),
    );
    expect(res.status).toBe(404);
    expect(await h.prisma.note.count()).toBe(before);
  });

  it("POST binding a phantom highlightId -> 404, no note created", async () => {
    const { POST } = await import("@/app/api/opds/notes/route");
    const before = await h.prisma.note.count();
    const res = await POST(
      postReq(TOKEN_A, {
        bookId: seed.bookId,
        anchor: { type: "epub-cfi", cfi: "/6/2" },
        body: "phantom-anchor note",
        highlightId: "does-not-exist",
      }),
    );
    expect(res.status).toBe(404);
    expect(await h.prisma.note.count()).toBe(before);
  });
});

describe("/api/opds/notes — CRUD over the token path", () => {
  it("POST creates, then GET lists it (write→read round-trip)", async () => {
    const { POST, GET } = await import("@/app/api/opds/notes/route");
    const anchor = { type: "epub-cfi", cfi: "/6/4[chap01]!/4/2" };
    const postRes = await POST(
      postReq(TOKEN_A, { bookId: seed.bookId, anchor, body: "freeform note" }),
    );
    expect(postRes.status).toBe(200);
    const created = (await postRes.json()) as {
      id: string;
      body: string;
      anchor: unknown;
      highlightId: string | null;
    };
    expect(created.body).toBe("freeform note");
    expect(created.anchor).toEqual(anchor);
    expect(created.highlightId).toBeNull();

    const getRes = await GET(getReq(TOKEN_A, seed.bookId));
    expect(getRes.status).toBe(200);
    const { notes } = (await getRes.json()) as { notes: { id: string; body: string }[] };
    expect(notes.find((n) => n.id === created.id)?.body).toBe("freeform note");
  });

  it("PATCH updates the body, DELETE returns 204 then the row is gone", async () => {
    const { POST } = await import("@/app/api/opds/notes/route");
    const { PATCH, DELETE } = await import("@/app/api/opds/notes/[id]/route");

    const created = (await (
      await POST(
        postReq(TOKEN_A, {
          bookId: seed.bookId,
          anchor: { type: "epub-cfi", cfi: "/6/6" },
          body: "before edit",
        }),
      )
    ).json()) as { id: string };

    const patchRes = await PATCH(
      idReq(TOKEN_A, created.id, "PATCH", { body: "after edit" }),
      idCtx(created.id),
    );
    expect(patchRes.status).toBe(200);
    expect((await patchRes.json()).body).toBe("after edit");

    const delRes = await DELETE(idReq(TOKEN_A, created.id, "DELETE"), idCtx(created.id));
    expect(delRes.status).toBe(204);
    expect(await h.prisma.note.findUnique({ where: { id: created.id } })).toBeNull();
  });

  it("PATCH missing body field -> 400", async () => {
    const { POST } = await import("@/app/api/opds/notes/route");
    const { PATCH } = await import("@/app/api/opds/notes/[id]/route");
    const created = (await (
      await POST(
        postReq(TOKEN_A, {
          bookId: seed.bookId,
          anchor: { type: "epub-cfi", cfi: "/6/6" },
          body: "has a body",
        }),
      )
    ).json()) as { id: string };

    const res = await PATCH(
      idReq(TOKEN_A, created.id, "PATCH", { notbody: "x" }),
      idCtx(created.id),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("missing body");
    await h.prisma.note.delete({ where: { id: created.id } });
  });
});

describe("/api/opds/notes — cross-user isolation", () => {
  it("A's token GET never returns B's note", async () => {
    const { GET } = await import("@/app/api/opds/notes/route");
    const res = await GET(getReq(TOKEN_A, seed.bookId));
    const { notes } = (await res.json()) as { notes: { id: string }[] };
    expect(notes.find((n) => n.id === seed.noteOfB)).toBeUndefined();
  });

  it("A's token cannot PATCH B's note -> 404, B's row unchanged", async () => {
    const { PATCH } = await import("@/app/api/opds/notes/[id]/route");
    const res = await PATCH(
      idReq(TOKEN_A, seed.noteOfB, "PATCH", { body: "hijacked" }),
      idCtx(seed.noteOfB),
    );
    expect(res.status).toBe(404);
    const row = await h.prisma.note.findUnique({ where: { id: seed.noteOfB } });
    expect(row?.body).toBe("B's private note");
  });

  it("A's token cannot DELETE B's note -> 404, B's row survives", async () => {
    const { DELETE } = await import("@/app/api/opds/notes/[id]/route");
    const res = await DELETE(idReq(TOKEN_A, seed.noteOfB, "DELETE"), idCtx(seed.noteOfB));
    expect(res.status).toBe(404);
    expect(
      await h.prisma.note.findUnique({ where: { id: seed.noteOfB } }),
    ).not.toBeNull();
  });
});
