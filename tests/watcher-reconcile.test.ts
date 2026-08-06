// The watcher's reconcile-delete sweep, and the settlement that must precede
// it — against a REAL ephemeral SQLite DB, same seam as tests/scanner.test.ts.
//
// Why this suite exists: on 2026-08-06 a media-mount move destroyed a
// library's annotations. The sweep (then inlined in the "ready" handler) saw
// every old path as missing before the initial walk's hash re-link scans
// could repoint the rows, and Prisma's onDelete: Cascade took the notes,
// highlights and ink with them. The fix splits the sweep into a callable
// (`reconcileMissingBooks`) gated by a `ScanTracker` that waits for scans to
// settle. These tests pin both halves plus the mount-move scenario end to
// end. Chokidar itself stays out, per this suite's convention — the "ready"
// wiring is three lines and reviewable; the logic is what regresses.

import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
  vi,
} from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const h = await vi.hoisted(async () => {
  const { mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const path = (await import("node:path")).default;
  const { PrismaClient } = await import("@prisma/client");
  const dir = mkdtempSync(path.join(tmpdir(), "hlr-reconcile-"));
  const dbFile = path.join(dir, "test.db");
  const url = `file:${dbFile}`;
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  return { dir, url, prisma };
});

vi.mock("@/lib/prisma", () => ({ prisma: h.prisma }));

vi.mock("@/lib/scanner/covers", () => ({
  writeCover: vi.fn(async () => "cover-stub.jpg"),
}));

import { ScanTracker, reconcileMissingBooks } from "@/lib/scanner/watcher";
import { scanFile } from "@/lib/scanner/index";
import { fileHash } from "@/lib/scanner/hash";

const FIXTURES = path.join(__dirname, "fixtures");
const VALID_EPUB = path.join(FIXTURES, "valid.epub");

let lib: string;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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
  lib = mkdtempSync(path.join(tmpdir(), "hlr-lib-"));
  // Same offline stub as scanner.test.ts: the thin fixture would otherwise
  // trigger a real OpenLibrary enrich fetch inside scanFile.
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify({ docs: [] }), { status: 200 })),
  );
  await h.prisma.note.deleteMany();
  await h.prisma.book.deleteMany();
  await h.prisma.user.deleteMany();
});

afterEach(() => {
  vi.unstubAllGlobals();
  rmSync(lib, { recursive: true, force: true });
});

describe("ScanTracker.settle", () => {
  it("resolves promptly when nothing was ever tracked", async () => {
    const t = new ScanTracker();
    const start = Date.now();
    await t.settle(200);
    expect(Date.now() - start).toBeLessThan(150);
  });

  it("does not resolve before an in-flight scan finishes", async () => {
    const t = new ScanTracker();
    let scanDone = false;
    void t.track(
      sleep(150).then(() => {
        scanDone = true;
      }),
    );
    await t.settle(50);
    expect(scanDone).toBe(true);
  });

  it("a rejecting scan still settles instead of wedging the sweep", async () => {
    const t = new ScanTracker();
    void t.track(sleep(30).then(() => Promise.reject(new Error("boom"))));
    await expect(t.settle(50)).resolves.toBeUndefined();
  });

  it("waits out the quiet window after the last scan", async () => {
    const t = new ScanTracker();
    void t.track(sleep(20));
    const start = Date.now();
    await t.settle(200);
    // ≥ the window minus scheduling slop — the point is it didn't return the
    // instant the scan resolved.
    expect(Date.now() - start).toBeGreaterThanOrEqual(150);
  });
});

describe("reconcileMissingBooks", () => {
  it("removes rows whose file is gone, keeps rows whose file exists", async () => {
    const present = path.join(lib, "present.epub");
    copyFileSync(VALID_EPUB, present);
    await h.prisma.book.create({
      data: { filePath: present, format: "epub", title: "Present" },
    });
    await h.prisma.book.create({
      data: { filePath: path.join(lib, "gone.epub"), format: "epub", title: "Gone" },
    });

    const removed = await reconcileMissingBooks();

    expect(removed).toBe(1);
    const rows = await h.prisma.book.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0].filePath).toBe(present);
  });
});

describe("reconcileMissingBooks — empty-mount refusal", () => {
  it("refuses to delete when every book is missing (unmounted/renamed disk)", async () => {
    await h.prisma.book.create({
      data: { filePath: path.join(lib, "a.epub"), format: "epub", title: "A" },
    });
    await h.prisma.book.create({
      data: { filePath: path.join(lib, "b.epub"), format: "epub", title: "B" },
    });

    const removed = await reconcileMissingBooks();

    expect(removed).toBe(0);
    expect(await h.prisma.book.count()).toBe(2);
  });
});

describe("mount move — identity follows the book", () => {
  it("a settled scan repoints the row first, so reconcile deletes nothing and notes survive", async () => {
    // The library as it was before the move: a row pointing at the old path,
    // with a note attached. The old path no longer exists on disk.
    const newPath = path.join(lib, "moved.epub");
    copyFileSync(VALID_EPUB, newPath);
    const hash = await fileHash(newPath);
    const book = await h.prisma.book.create({
      data: {
        filePath: path.join(lib, "old-mount", "moved.epub"),
        fileHash: hash,
        format: "epub",
        title: "Moved",
      },
    });
    const user = await h.prisma.user.create({
      data: { username: "reader", passwordHash: "x" },
    });
    await h.prisma.note.create({
      data: {
        bookId: book.id,
        userId: user.id,
        anchor: JSON.stringify({ type: "epub-cfi", cfi: "/6/2!/4/2" }),
        body: "survives the move",
      },
    });

    // What the watcher now does on boot: scan (tracked), settle, THEN sweep.
    const tracker = new ScanTracker();
    void tracker.track(scanFile(newPath));
    await tracker.settle(50);
    const removed = await reconcileMissingBooks();

    expect(removed).toBe(0);
    const rows = await h.prisma.book.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(book.id);
    expect(rows[0].filePath).toBe(newPath);
    const notes = await h.prisma.note.findMany();
    expect(notes).toHaveLength(1);
    expect(notes[0].body).toBe("survives the move");
  });
});
