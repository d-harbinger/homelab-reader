// HIGHLIGHT-COLORS-01 — the highlight palette is the single source of truth for
// the colors the /api/highlights routes accept (Slice 1 of the reader
// annotation-UX plan, 2026-06-13).
//
// Two contracts are proven here:
//
//   (A) Palette data — the expanded 7-color set (yellow/green/blue/pink +
//       orange/purple/red) exists in HIGHLIGHT_COLORS and HIGHLIGHT_ORDER, every
//       entry keeps the soft rgba(...,0.4) alpha convention, and the union /
//       record / order stay in lockstep.
//
//   (B) Route validation single-sources from the palette — POST /api/highlights
//       ACCEPTS a newly-added color ("orange") and REJECTS an unknown color with
//       a 400, proving the route validates against the palette keys rather than a
//       stale inline list that could drift.
//
// The route seam mirrors tests/library-folders.test.ts: a vi.hoisted() ephemeral
// PrismaClient bound to a temp SQLite file (injected via vi.mock("@/lib/prisma")),
// the @/auth seam mocked so the real getCurrentUser logic runs against a fake
// session, committed migrations applied to the throwaway file in beforeAll.

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
import { rmSync } from "node:fs";

import {
  HIGHLIGHT_COLORS,
  HIGHLIGHT_ORDER,
  type HighlightColor,
} from "@/lib/highlight-colors";

// --- (A) Palette data contract — no DB, pure --------------------------------

describe("highlight palette data", () => {
  const NEW_COLORS = ["orange", "purple", "red"] as const;
  const LEGACY_COLORS = ["yellow", "green", "blue", "pink"] as const;

  it("contains the expanded 7-color set", () => {
    expect(Object.keys(HIGHLIGHT_COLORS).sort()).toEqual(
      [...LEGACY_COLORS, ...NEW_COLORS].sort(),
    );
  });

  it("adds orange, purple and red to HIGHLIGHT_COLORS with the rgba(...,0.4) alpha convention", () => {
    for (const name of NEW_COLORS) {
      const entry = HIGHLIGHT_COLORS[name as HighlightColor];
      expect(entry, `missing palette entry for ${name}`).toBeTruthy();
      // soft overlay convention: rgba(r, g, b, 0.4)
      expect(entry.fill).toMatch(/^rgba\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*0\.4\s*\)$/);
      expect(entry.swatch).toMatch(/^#[0-9a-fA-F]{6}$/);
      expect(entry.label.length).toBeGreaterThan(0);
    }
  });

  it("keeps every existing color on the rgba(...,0.4) alpha convention", () => {
    for (const entry of Object.values(HIGHLIGHT_COLORS)) {
      expect(entry.fill).toMatch(/,\s*0\.4\s*\)$/);
    }
  });

  it("lists the new colors in HIGHLIGHT_ORDER", () => {
    for (const name of NEW_COLORS) {
      expect(HIGHLIGHT_ORDER).toContain(name);
    }
  });

  it("keeps HIGHLIGHT_ORDER in lockstep with HIGHLIGHT_COLORS (no drift)", () => {
    expect([...HIGHLIGHT_ORDER].sort()).toEqual(
      Object.keys(HIGHLIGHT_COLORS).sort(),
    );
  });
});

// --- (B) Route validation single-sources from the palette -------------------

// hoisted: build the temp DB url + client before any module import
const h = await vi.hoisted(async () => {
  const { mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const path = (await import("node:path")).default;
  const { PrismaClient } = await import("@prisma/client");
  const dir = mkdtempSync(path.join(tmpdir(), "hlr-hlcolors-"));
  const dbFile = path.join(dir, "test.db");
  const url = `file:${dbFile}`;
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  return { dir, url, prisma };
});

vi.mock("@/lib/prisma", () => ({ prisma: h.prisma }));
vi.mock("@/auth", () => ({ auth: vi.fn() }));

import { asReader, signOut } from "./helpers/auth-mock";
import { POST } from "@/app/api/highlights/route";

beforeAll(() => {
  execFileSync("npx", ["prisma", "migrate", "deploy"], {
    env: { ...process.env, DATABASE_URL: h.url },
    stdio: "inherit",
  });
});

afterAll(async () => {
  await h.prisma.$disconnect();
  rmSync(h.dir, { recursive: true, force: true });
});

beforeEach(async () => {
  vi.clearAllMocks();
  signOut();
  await h.prisma.highlight.deleteMany();
  await h.prisma.book.deleteMany();
  await h.prisma.user.deleteMany();
});

function postReq(body: unknown): Request {
  return new Request("http://test/api/highlights", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function makeUser(id: string) {
  return h.prisma.user.create({
    data: { id, username: `user-${id}`, passwordHash: "x", role: "reader" },
  });
}

async function makeBook() {
  return h.prisma.book.create({
    data: { filePath: "/books/x.epub", format: "epub", title: "X" },
  });
}

const ANCHOR = { type: "epub-cfi-range", cfi: "/6/2!/4" };

describe("POST /api/highlights color validation single-sources from the palette", () => {
  it("accepts a newly-added palette color (orange)", async () => {
    const book = await makeBook();
    await makeUser("u-reader");
    asReader("u-reader");
    const res = await POST(
      postReq({ bookId: book.id, anchor: ANCHOR, text: "hi", color: "orange" }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.color).toBe("orange");
  });

  it("rejects an unknown color with a 400 (not a silent fallback)", async () => {
    const book = await makeBook();
    await makeUser("u-reader");
    asReader("u-reader");
    const res = await POST(
      postReq({
        bookId: book.id,
        anchor: ANCHOR,
        text: "hi",
        color: "chartreuse",
      }),
    );
    expect(res.status).toBe(400);
  });

  it("still accepts a legacy color (yellow)", async () => {
    const book = await makeBook();
    await makeUser("u-reader");
    asReader("u-reader");
    const res = await POST(
      postReq({ bookId: book.id, anchor: ANCHOR, text: "hi", color: "yellow" }),
    );
    expect(res.status).toBe(200);
    expect((await res.json()).color).toBe("yellow");
  });

  it("defaults to yellow when no color is supplied", async () => {
    const book = await makeBook();
    await makeUser("u-reader");
    asReader("u-reader");
    const res = await POST(
      postReq({ bookId: book.id, anchor: ANCHOR, text: "hi" }),
    );
    expect(res.status).toBe(200);
    expect((await res.json()).color).toBe("yellow");
  });
});
