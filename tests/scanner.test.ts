// TEST-03 — scanner reconcile-branch coverage against a REAL ephemeral SQLite DB.
//
// scanFile() is the single "this file changed on disk" entry point with three
// idempotency branches (src/lib/scanner/index.ts). A regression here corrupts
// the library (duplicate rows, lost notes, ghost books), so these are the
// highest-value untested paths in the repo. We drive scanFile directly against
// committed fixtures staged into a temp library dir — no chokidar, no timing.
//
// Seam = the same one the isolation suite uses (strategy b): a vi.hoisted()
// ephemeral PrismaClient bound to a temp SQLite file, injected via
// vi.mock("@/lib/prisma"), with the committed migrations applied in beforeAll.
// scanFile/extractEpub and the failed-imports helper all import that same
// mocked singleton, so every query in this file hits the throwaway DB.

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

// --- hoisted: build the temp DB url + client before any module import -------
// vi.hoisted runs ABOVE the top-level imports, so it imports what it needs
// internally (resolution happens at call time) rather than using the
// not-yet-initialized top-level bindings.
const h = await vi.hoisted(async () => {
  const { mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const path = (await import("node:path")).default;
  const { PrismaClient } = await import("@prisma/client");
  const dir = mkdtempSync(path.join(tmpdir(), "hlr-scan-"));
  const dbFile = path.join(dir, "test.db");
  const url = `file:${dbFile}`;
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  return { dir, url, prisma };
});

// Inject the ephemeral client wherever scanFile / failed-imports import prisma.
vi.mock("@/lib/prisma", () => ({ prisma: h.prisma }));

// Cover writing touches the filesystem (the prod cover-cache dir). The scanner
// branches under test only care about the Book rows, so stub writeCover to a
// deterministic no-op path — keeps the suite from writing into ./data.
vi.mock("@/lib/scanner/covers", () => ({
  writeCover: vi.fn(async () => "cover-stub.jpg"),
}));

import { scanFile, removeFileFromLibrary } from "@/lib/scanner/index";
import { extractEpub } from "@/lib/scanner/epub";
import { recordFailedImport } from "@/lib/scanner/failed-imports";

// Repo-root fixtures (committed alongside this suite).
const FIXTURES = path.join(__dirname, "fixtures");
const VALID_EPUB = path.join(FIXTURES, "valid.epub");
const VALID2_EPUB = path.join(FIXTURES, "valid2.epub");
const VALID_PDF = path.join(FIXTURES, "valid.pdf");
const CORRUPT_EPUB = path.join(FIXTURES, "corrupt.epub");

// A temp "library" dir we stage fixtures into and feed to scanFile by absolute
// path — mirrors how chokidar would hand the scanner a real on-disk path.
let lib: string;

function stage(fixture: string, asName: string): string {
  const dest = path.join(lib, asName);
  copyFileSync(fixture, dest);
  return dest;
}

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

// Fresh library dir + empty tables per test, so branch assertions about row
// counts / ids never bleed across cases.
beforeEach(async () => {
  vi.clearAllMocks();
  lib = mkdtempSync(path.join(tmpdir(), "hlr-lib-"));
  // The enrich-on-import hook (D3) now runs after a brand-new book.create. The
  // committed fixtures are "thin" (no ISBN), so scanFile would call the real
  // OpenLibrary fetch during these reconcile-branch tests. Stub the global fetch
  // to an empty-docs response: offline + deterministic, and (since searchOpen-
  // Library returns [] for no docs) zero BookSuggestion rows, so the branch
  // assertions about Book counts are untouched. The dedicated enrich coverage
  // lives in tests/scanner-enrich.test.ts.
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify({ docs: [] }), { status: 200 })),
  );
  await h.prisma.bookSuggestion.deleteMany();
  await h.prisma.failedImport.deleteMany();
  await h.prisma.book.deleteMany();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("scanFile reconcile branches (TEST-03)", () => {
  it("Branch A — hash-match moved file: path updates, no duplicate Book", async () => {
    const first = stage(VALID_EPUB, "book.epub");
    await scanFile(first);

    const created = await h.prisma.book.findMany();
    expect(created).toHaveLength(1);
    const original = created[0];

    // Same bytes at a NEW path → hash matches the existing row. scanFile must
    // update that row's filePath in place, not insert a second Book.
    const moved = stage(VALID_EPUB, "moved.epub");
    await scanFile(moved);

    const after = await h.prisma.book.findMany();
    expect(after).toHaveLength(1); // no duplicate
    expect(after[0].id).toBe(original.id); // same row, notes preserved
    expect(after[0].filePath).toBe(moved); // path followed the move
  });

  it("Branch B — same path, different valid bytes: same Book.id, re-extracted", async () => {
    const at = path.join(lib, "book.epub");

    // First import: valid.epub (title "Valid Fixture One").
    copyFileSync(VALID_EPUB, at);
    await scanFile(at);
    const first = await h.prisma.book.findUnique({ where: { filePath: at } });
    expect(first).not.toBeNull();
    expect(first?.title).toBe("Valid Fixture One");

    // Overwrite the SAME path with DIFFERENT valid bytes (valid2.epub). Because
    // the bytes differ, the hash no longer matches (so we don't hit branch A);
    // the path still matches an existing Book → branch B re-extracts in place.
    copyFileSync(VALID2_EPUB, at);
    await scanFile(at);

    const all = await h.prisma.book.findMany();
    expect(all).toHaveLength(1); // no duplicate row
    const updated = all[0];
    expect(updated.id).toBe(first!.id); // SAME Book.id retained (notes survive)
    expect(updated.title).toBe("Valid Fixture Two"); // metadata re-extracted
    expect(updated.fileHash).not.toBe(first!.fileHash); // content changed
  });

  it("Branch C — brand-new file: a new Book row is created", async () => {
    const at = stage(VALID_PDF, "fresh.pdf");
    await scanFile(at);

    const books = await h.prisma.book.findMany();
    expect(books).toHaveLength(1);
    expect(books[0].format).toBe("pdf");
    expect(books[0].filePath).toBe(at);
    // A title is always set (extracted or basename fallback), never empty.
    expect(books[0].title.length).toBeGreaterThan(0);
  });

  it("Branch C (epub) — new EPUB creates a Book with the extracted title", async () => {
    const at = stage(VALID_EPUB, "fresh.epub");
    await scanFile(at);

    const books = await h.prisma.book.findMany();
    expect(books).toHaveLength(1);
    expect(books[0].title).toBe("Valid Fixture One");
    expect(books[0].format).toBe("epub");
  });

  it("Branch A (dup) — duplicate content never collides on filePath (regression)", async () => {
    // Two identical files coexisting (a duplicate book dropped into the library
    // twice). The old hash-FIRST reconcile repointed a hash-matched row onto a
    // path another row already owned → "Unique constraint failed on `filePath`",
    // surfaced to the user as a bogus "couldn't be read" failed import.
    const a = stage(VALID_EPUB, "dup-a.epub");
    await scanFile(a);
    const first = await h.prisma.book.findFirstOrThrow();

    // Seed the exact pre-crash DB state: a second row with the SAME content hash
    // at a different, still-present path (how concurrent scans of duplicates can
    // leave things). Re-scanning a real file must reconcile without throwing —
    // the path-first reconcile guarantees the repoint never targets an owned path.
    const b = stage(VALID_EPUB, "dup-b.epub");
    await h.prisma.book.create({
      data: { filePath: b, fileHash: first.fileHash, format: "epub", title: "Dup" },
    });

    await expect(scanFile(b)).resolves.toBeUndefined();
    await expect(scanFile(a)).resolves.toBeUndefined();
    expect((await h.prisma.book.findMany()).length).toBeGreaterThanOrEqual(1);
  });
});

describe("malformed archive → FailedImport, not a silent drop (TEST-03 / ROBUST-05)", () => {
  it("extractEpub throws on a corrupt EPUB", async () => {
    const at = stage(CORRUPT_EPUB, "broken.epub");
    await expect(extractEpub(at)).rejects.toThrow();
  });

  it("watcher boundary records a FailedImport and creates no Book", async () => {
    const at = stage(CORRUPT_EPUB, "broken.epub");

    // Reproduce the watcher's add-handler boundary (src/lib/scanner/watcher.ts):
    // scanFile throws on the corrupt archive; the boundary catches and records a
    // FailedImport instead of letting the throw escape and the book vanish.
    let threw = false;
    try {
      await scanFile(at);
    } catch (err) {
      threw = true;
      await recordFailedImport(at, "epub", err);
    }

    expect(threw).toBe(true); // extraction genuinely failed

    const books = await h.prisma.book.findMany();
    expect(books).toHaveLength(0); // no Book row for the corrupt file

    const failures = await h.prisma.failedImport.findMany();
    expect(failures).toHaveLength(1);
    expect(failures[0].filePath).toBe(at);
    expect(failures[0].format).toBe("epub");
    expect(failures[0].error.length).toBeGreaterThan(0);
  });

  it("a later successful import at that path can clear the failure", async () => {
    const at = path.join(lib, "book.epub");

    // Start failed.
    copyFileSync(CORRUPT_EPUB, at);
    try {
      await scanFile(at);
    } catch (err) {
      await recordFailedImport(at, "epub", err);
    }
    expect(await h.prisma.failedImport.count()).toBe(1);

    // Replace with valid bytes; the watcher clears the failure on success. Drive
    // removeFileFromLibrary here is unnecessary — assert the success path clears.
    const { clearFailedImport } = await import("@/lib/scanner/failed-imports");
    copyFileSync(VALID_EPUB, at);
    await scanFile(at);
    await clearFailedImport(at);

    expect(await h.prisma.failedImport.count()).toBe(0);
    expect(await h.prisma.book.count()).toBe(1);
  });

  it("walkAndScan (manual rescan) records failures and clears them on success", async () => {
    // Previously only the watcher recorded FailedImport rows; a book failing
    // during a manual rescan just bumped a counter nobody rendered, so the
    // banner stayed empty. walkAndScan now uses the same record/clear pair.
    const { walkAndScan } = await import("@/lib/scanner/index");

    const broken = stage(CORRUPT_EPUB, "broken.epub");
    stage(VALID_EPUB, "fine.epub");

    const stats = await walkAndScan(lib);
    expect(stats.scanned).toBe(1);
    expect(stats.errors).toBe(1);

    const failures = await h.prisma.failedImport.findMany();
    expect(failures).toHaveLength(1);
    expect(failures[0].filePath).toBe(broken);
    expect(await h.prisma.book.count()).toBe(1); // the valid one imported

    // Fix the broken file in place; the next manual rescan clears the record.
    copyFileSync(VALID2_EPUB, broken);
    const stats2 = await walkAndScan(lib);
    expect(stats2.errors).toBe(0);
    expect(await h.prisma.failedImport.count()).toBe(0);
    expect(await h.prisma.book.count()).toBe(2);
  });
});

describe("removeFileFromLibrary (TEST-03)", () => {
  it("deletes the Book row for a removed path", async () => {
    const at = stage(VALID_EPUB, "book.epub");
    await scanFile(at);
    expect(await h.prisma.book.count()).toBe(1);

    await removeFileFromLibrary(at);
    expect(await h.prisma.book.count()).toBe(0);
  });
});
