// SHELVES-AUTO ROUTE — the sorting bench's OpenLibrary sweep.
//   POST /api/shelves/auto → one batch of lookups for shelf-less books
//
// This suite exists because of a 2026-08-07 report that matching "got worse".
// The scoring function had not changed; the sweep around it had. Once the
// bench started running batch after batch unattended (44a55ab), a single run
// was long enough to meet OpenLibrary's throttle — and every throttled lookup
// came back as an empty list, indistinguishable from "this book is unknown".
// The sweep recorded those as permanent no-match verdicts, excluded the books
// from every later batch AND from the remaining count, then reported "Done"
// over books it had never actually looked up. On a large library that reads
// exactly like the matcher falling apart partway through.
//
// The contract these tests pin:
//   - a throttled or failed lookup leaves the book IN the queue;
//   - the sweep yields instead of grinding the rest of the library against a
//     service that is refusing;
//   - a genuine "nothing matched" is still remembered, so re-runs progress;
//   - a later run picks up the books the throttle interrupted, and shelves them.
//
// Seam mirrors tests/suggestions-route.test.ts: a vi.hoisted() ephemeral
// PrismaClient on a temp SQLite file, the @/auth seam mocked. Global fetch is
// stubbed rather than the openlibrary module, so the real status-code
// classification runs as part of the path under test.

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";

const h = await vi.hoisted(async () => {
  const { mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const path = (await import("node:path")).default;
  const { PrismaClient } = await import("@prisma/client");
  const dir = mkdtempSync(path.join(tmpdir(), "hlr-shelves-auto-"));
  const url = `file:${path.join(dir, "test.db")}`;
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  return { dir, url, prisma };
});

vi.mock("@/lib/prisma", () => ({ prisma: h.prisma }));
vi.mock("@/auth", () => ({ auth: vi.fn() }));

import { asAdmin } from "./helpers/auth-mock";
import { ONLINE_LOOKUPS_KEY } from "@/lib/app-settings";

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

// An OpenLibrary /search.json body whose top doc classifies cleanly.
const HIT = {
  docs: [
    {
      key: "/works/OLTCP",
      title: "TCP/IP Illustrated",
      author_name: ["W. Richard Stevens"],
      subject: ["TCP/IP (Computer network protocol)", "Computer networks"],
      first_publish_year: 1994,
      cover_i: 1,
    },
  ],
};

const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body });
const refused = (status: number) => ({ ok: false, status, json: async () => ({}) });

interface SweepResult {
  processed: number;
  shelved: number;
  suggested: number;
  skipped: number;
  failed: number;
  stopped: "throttled" | "unreachable" | null;
  remaining: number;
}

async function sweep(): Promise<SweepResult> {
  // Imported inside the helper so each test file run gets the module fresh
  // — the route memoizes genuinely-unmatchable books for the process
  // lifetime, which is state these tests deliberately exercise.
  const { POST } = await import("@/app/api/shelves/auto/route");
  const res = await POST(new Request("http://localhost/api/shelves/auto", { method: "POST" }));
  return (await res.json()) as SweepResult;
}

/** Seed `n` shelf-less books, oldest first (the order the sweep consumes). */
async function seedBooks(prefix: string, n: number): Promise<void> {
  for (let i = 0; i < n; i++) {
    await h.prisma.book.create({
      data: {
        filePath: `/books/${prefix}-${i}.pdf`,
        format: "pdf",
        title: `TCP/IP Illustrated ${prefix} ${i}`,
        genre: null,
        addedAt: new Date(Date.now() + i * 1000),
      },
    });
  }
}

beforeEach(async () => {
  vi.resetModules();
  vi.unstubAllGlobals();
  await h.prisma.bookSuggestion.deleteMany();
  await h.prisma.book.deleteMany();
  await h.prisma.appSetting.deleteMany();
  await h.prisma.user.deleteMany();
  const admin = await h.prisma.user.create({
    data: { username: "admin", passwordHash: "x", role: "admin" },
  });
  asAdmin(admin.id);
  await h.prisma.appSetting.create({ data: { key: ONLINE_LOOKUPS_KEY, value: "on" } });
});

describe("POST /api/shelves/auto — a throttle is not a verdict", () => {
  it("leaves throttled books in the queue and stops the sweep", async () => {
    await seedBooks("throttled", 5);
    let calls = 0;
    vi.stubGlobal("fetch", async () => {
      calls++;
      return refused(429);
    });

    const r = await sweep();

    expect(r.stopped).toBe("throttled");
    expect(r.failed).toBe(1);
    expect(r.skipped).toBe(0);
    // Yields on the first refusal rather than burning through the library.
    expect(calls).toBe(1);
    // The whole pile is still queued — nothing was written off.
    expect(r.remaining).toBe(5);
  });

  it("re-attempts a throttled book on the next run and shelves it", async () => {
    await seedBooks("recovers", 1);
    vi.stubGlobal("fetch", async () => refused(429));
    const first = await sweep();
    expect(first.stopped).toBe("throttled");
    expect(first.remaining).toBe(1);

    // The service recovers. Under the old behaviour the book had already been
    // memoized as "no match" and was never looked up again.
    vi.stubGlobal("fetch", async () => ok(HIT));
    const second = await sweep();

    expect(second.stopped).toBeNull();
    expect(second.shelved).toBe(1);
    expect(second.remaining).toBe(0);
    const book = await h.prisma.book.findFirst();
    expect(book?.genre).toBe("Networking & Sysadmin");
  });

  it("gives up after a short run of failures instead of grinding the queue", async () => {
    await seedBooks("unreachable", 10);
    let calls = 0;
    vi.stubGlobal("fetch", async () => {
      calls++;
      throw new Error("network down");
    });

    const r = await sweep();

    expect(r.stopped).toBe("unreachable");
    expect(calls).toBe(3);
    expect(r.failed).toBe(3);
    expect(r.skipped).toBe(0);
    expect(r.remaining).toBe(10);
  });
});

describe("POST /api/shelves/auto — a real answer is still remembered", () => {
  it("records a genuine no-match so repeated batches make progress", async () => {
    await seedBooks("nomatch", 3);
    vi.stubGlobal("fetch", async () => ok({ docs: [] }));

    const first = await sweep();
    expect(first.stopped).toBeNull();
    expect(first.skipped).toBe(3);
    expect(first.failed).toBe(0);
    // Answered and unmatchable — dropped from the actionable queue, which is
    // what lets a whole-library sweep terminate.
    expect(first.remaining).toBe(0);

    const second = await sweep();
    expect(second.processed).toBe(0);
  });

  it("shelves a confident match and reports a clean run", async () => {
    await seedBooks("hit", 2);
    vi.stubGlobal("fetch", async () => ok(HIT));

    const r = await sweep();

    expect(r.stopped).toBeNull();
    expect(r.failed).toBe(0);
    expect(r.shelved).toBe(2);
    expect(r.processed).toBe(2);
    expect(r.remaining).toBe(0);
  });
});
