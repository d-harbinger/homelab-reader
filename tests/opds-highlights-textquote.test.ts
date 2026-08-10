// Phase C slice P1 — text-quote anchors accepted end-to-end + the one-time
// upgrade PATCH, exercised over the OPDS token door (the android-facing front
// door). Prisma is NOT mocked for the data path (same rationale as
// opds-highlights): the shared annotations lib body is the exact code the
// cookie-session route runs, so proving the branches here proves both doors.
//
// Branches (each covered below):
//   create
//     C1 valid text-quote            -> 200, stored anchor is the normalized envelope
//     C2 missing quote               -> 400 (anchor validation, text still supplied)
//     C3 oversize quote              -> 400
//     C4 bad progression (string)    -> 400
//     C5 progression clamped         -> 200, stored progression pinned to [0,1]
//   upgrade PATCH
//     U1 happy path                  -> 200, anchor becomes epub-cfi-range with the
//                                        resolved cfi AND preserved quote/prefix/
//                                        suffix/progression
//     U2 wrong state                 -> 400 when the stored anchor is NOT text-quote
//     U3 bad shape                   -> 400 when the upgrade anchor lacks a cfi
//   GET
//     G1 round-trips the envelope fields through list

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
  const dir = mkdtempSync(path.join(tmpdir(), "hlr-opds-tq-"));
  const dbFile = path.join(dir, "test.db");
  const url = `file:${dbFile}`;
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  return { dir, url, prisma };
});

vi.mock("@/lib/prisma", () => ({ prisma: h.prisma }));

const sha = (t: string) => createHash("sha256").update(t).digest("hex");

const TOKEN_A = "token-alpha-synthetic";

interface Seed {
  bookId: string;
}
let seed: Seed;

function auth(token: string): Record<string, string> {
  const cred = Buffer.from(`ignored-username:${token}`).toString("base64");
  return { authorization: `Basic ${cred}` };
}

function postReq(token: string, body: unknown): Request {
  return new Request("http://t/api/opds/highlights", {
    method: "POST",
    headers: { "content-type": "application/json", ...auth(token) },
    body: JSON.stringify(body),
  });
}

function getReq(token: string, bookId: string): Request {
  return new Request(
    `http://t/api/opds/highlights?bookId=${encodeURIComponent(bookId)}`,
    { headers: auth(token) },
  );
}

function patchReq(token: string, id: string, body: unknown): Request {
  return new Request(`http://t/api/opds/highlights/${id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json", ...auth(token) },
    body: JSON.stringify(body),
  });
}

const idCtx = (id: string) => ({ params: Promise.resolve({ id }) });

async function createTextQuote(body: unknown) {
  const { POST } = await import("@/app/api/opds/highlights/route");
  return POST(postReq(TOKEN_A, body));
}

beforeAll(async () => {
  execFileSync("npx", ["prisma", "migrate", "deploy"], {
    env: { ...process.env, DATABASE_URL: h.url },
    stdio: "inherit",
  });

  const a = await h.prisma.user.create({
    data: { username: "user-a", passwordHash: "x", role: "reader" },
  });
  await h.prisma.opdsToken.create({
    data: { userId: a.id, tokenHash: sha(TOKEN_A), label: "a-device", expiresAt: tokenExpiry() },
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

describe("P1 create — text-quote anchor", () => {
  it("C1 accepts a valid text-quote anchor and stores the normalized envelope", async () => {
    const anchor = {
      type: "text-quote",
      quote: "an exact selected sentence",
      prefix: "words before ",
      suffix: " words after",
      chapterHref: "OEBPS/ch01.xhtml",
      progression: 0.3,
    };
    const res = await createTextQuote({
      bookId: seed.bookId,
      anchor,
      text: "an exact selected sentence",
    });
    expect(res.status).toBe(200);
    const created = (await res.json()) as { anchor: unknown };
    expect(created.anchor).toEqual(anchor);
  });

  it("C2 rejects a text-quote anchor with no quote (400)", async () => {
    const res = await createTextQuote({
      bookId: seed.bookId,
      anchor: { type: "text-quote", prefix: "x" },
      text: "text is present so the generic guard passes",
    });
    expect(res.status).toBe(400);
  });

  it("C3 rejects an oversize quote (400)", async () => {
    const res = await createTextQuote({
      bookId: seed.bookId,
      anchor: { type: "text-quote", quote: "a".repeat(2001) },
      text: "oversize",
    });
    expect(res.status).toBe(400);
  });

  it("C4 rejects a non-numeric progression (400)", async () => {
    const res = await createTextQuote({
      bookId: seed.bookId,
      anchor: { type: "text-quote", quote: "x", progression: "half" },
      text: "bad progression",
    });
    expect(res.status).toBe(400);
  });

  it("C5 clamps an out-of-range progression before storing", async () => {
    const res = await createTextQuote({
      bookId: seed.bookId,
      anchor: { type: "text-quote", quote: "clamp me", progression: 1.9 },
      text: "clamp me",
    });
    expect(res.status).toBe(200);
    const created = (await res.json()) as { anchor: { progression?: number } };
    expect(created.anchor.progression).toBe(1);
  });
});

describe("P1 upgrade PATCH — text-quote -> epub-cfi-range", () => {
  it("U1 upgrades a text-quote highlight, preserving the quote context", async () => {
    const created = (await (
      await createTextQuote({
        bookId: seed.bookId,
        anchor: {
          type: "text-quote",
          quote: "resolve me",
          prefix: "before ",
          suffix: " after",
          progression: 0.5,
        },
        text: "resolve me",
      })
    ).json()) as { id: string };

    const { PATCH } = await import("@/app/api/opds/highlights/[id]/route");
    const res = await PATCH(
      patchReq(TOKEN_A, created.id, {
        anchor: { type: "epub-cfi-range", cfi: "/6/4[ch01]!/4/2,/1:0,/1:10" },
      }),
      idCtx(created.id),
    );
    expect(res.status).toBe(200);

    const row = await h.prisma.highlight.findUnique({ where: { id: created.id } });
    expect(JSON.parse(row!.anchor)).toEqual({
      type: "epub-cfi-range",
      cfi: "/6/4[ch01]!/4/2,/1:0,/1:10",
      quote: "resolve me",
      prefix: "before ",
      suffix: " after",
      progression: 0.5,
    });
  });

  it("U2 rejects an anchor PATCH when the stored anchor is not text-quote (400)", async () => {
    const created = (await (
      await createTextQuote({
        bookId: seed.bookId,
        anchor: { type: "epub-cfi-range", cfi: "/6/2" },
        text: "already a cfi anchor",
      })
    ).json()) as { id: string };

    const { PATCH } = await import("@/app/api/opds/highlights/[id]/route");
    const res = await PATCH(
      patchReq(TOKEN_A, created.id, {
        anchor: { type: "epub-cfi-range", cfi: "/6/4" },
      }),
      idCtx(created.id),
    );
    expect(res.status).toBe(400);

    // The stored anchor is left untouched by the rejected upgrade.
    const row = await h.prisma.highlight.findUnique({ where: { id: created.id } });
    expect(JSON.parse(row!.anchor)).toEqual({ type: "epub-cfi-range", cfi: "/6/2" });
  });

  it("U3 rejects an upgrade anchor with no cfi (400)", async () => {
    const created = (await (
      await createTextQuote({
        bookId: seed.bookId,
        anchor: { type: "text-quote", quote: "still pending" },
        text: "still pending",
      })
    ).json()) as { id: string };

    const { PATCH } = await import("@/app/api/opds/highlights/[id]/route");
    const res = await PATCH(
      patchReq(TOKEN_A, created.id, {
        anchor: { type: "epub-cfi-range" },
      }),
      idCtx(created.id),
    );
    expect(res.status).toBe(400);
  });

  it("U4 leaves the color-only PATCH path unchanged (no anchor field)", async () => {
    const created = (await (
      await createTextQuote({
        bookId: seed.bookId,
        anchor: { type: "text-quote", quote: "recolor me" },
        text: "recolor me",
      })
    ).json()) as { id: string };

    const { PATCH } = await import("@/app/api/opds/highlights/[id]/route");
    const res = await PATCH(
      patchReq(TOKEN_A, created.id, { color: "pink" }),
      idCtx(created.id),
    );
    expect(res.status).toBe(200);
    expect((await res.json()).color).toBe("pink");

    // The stored anchor is still the text-quote envelope, untouched.
    const row = await h.prisma.highlight.findUnique({ where: { id: created.id } });
    expect(JSON.parse(row!.anchor).type).toBe("text-quote");
  });
});

describe("P1 GET — envelope round-trip", () => {
  it("G1 lists a text-quote highlight with its envelope fields intact", async () => {
    const anchor = {
      type: "text-quote",
      quote: "list me back",
      prefix: "pre ",
      suffix: " post",
      chapterHref: "OEBPS/ch09.xhtml",
      progression: 0.9,
    };
    const created = (await (
      await createTextQuote({ bookId: seed.bookId, anchor, text: "list me back" })
    ).json()) as { id: string };

    const { GET } = await import("@/app/api/opds/highlights/route");
    const res = await GET(getReq(TOKEN_A, seed.bookId));
    const { highlights } = (await res.json()) as {
      highlights: { id: string; anchor: unknown }[];
    };
    const found = highlights.find((x) => x.id === created.id);
    expect(found?.anchor).toEqual(anchor);
  });
});
