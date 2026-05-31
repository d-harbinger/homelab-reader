// Ephemeral SQLite test database factory.
//
// Isolation tests must exercise the REAL `where: { userId }` query, not a
// mock (RESEARCH anti-pattern: mocking Prisma makes the userId filter a
// tautology). So each suite gets a throwaway SQLite file with the committed
// migrations applied, and a PrismaClient bound explicitly to that file's URL
// via the datasources constructor override — never the production singleton.
//
// Lifecycle:
//   const db = await makeTestDb();   // temp file + migrate deploy + client
//   ... seed + assertions against db.prisma ...
//   await db.cleanup();              // disconnect + remove the temp dir
//
// `db.url` is exposed so a suite may, if it prefers strategy (a), assign it to
// process.env.DATABASE_URL before importing the prisma singleton (see
// tests/setup.ts). The default strategy (b) injects db.prisma via
// vi.mock("@/lib/prisma").

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

export interface TestDb {
  prisma: PrismaClient;
  url: string;
  cleanup: () => Promise<void>;
}

export async function makeTestDb(): Promise<TestDb> {
  const dir = mkdtempSync(path.join(tmpdir(), "hlr-test-"));
  const dbFile = path.join(dir, "test.db");
  const url = `file:${dbFile}`;

  // Apply the committed migrations to the throwaway file so the test schema
  // can never drift from production (it reuses prisma/migrations/). The child
  // process gets DATABASE_URL scoped to this file only.
  execFileSync("npx", ["prisma", "migrate", "deploy"], {
    env: { ...process.env, DATABASE_URL: url },
    stdio: "inherit",
  });

  // Bind a client to THIS url, not the globalThis-memoized production client.
  const prisma = new PrismaClient({ datasources: { db: { url } } });

  return {
    prisma,
    url,
    async cleanup() {
      await prisma.$disconnect();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

// Seed two reader users (a, b), one book, and one Note / Highlight / Progress
// row all owned by user B. Returns the ids the isolation suite acts on:
// user A tries (and must fail) to reach B's rows.
export interface SeedResult {
  userA: string;
  userB: string;
  bookId: string;
  noteOfB: string;
  highlightOfB: string;
  progressOfB: string;
}

export async function seedTwoUsers(prisma: PrismaClient): Promise<SeedResult> {
  const a = await prisma.user.create({
    data: { username: "user-a", passwordHash: "x", role: "reader" },
  });
  const b = await prisma.user.create({
    data: { username: "user-b", passwordHash: "x", role: "reader" },
  });

  const book = await prisma.book.create({
    data: { filePath: "/seed/x.epub", format: "epub", title: "Seed Book" },
  });

  const note = await prisma.note.create({
    data: {
      bookId: book.id,
      userId: b.id,
      anchor: JSON.stringify({ type: "epub-cfi", cfi: "/6/2" }),
      body: "B's private note",
    },
  });

  const highlight = await prisma.highlight.create({
    data: {
      bookId: book.id,
      userId: b.id,
      anchor: JSON.stringify({ type: "epub-cfi-range", cfiStart: "/6/2", cfiEnd: "/6/4" }),
      text: "B's private highlight",
      color: "yellow",
    },
  });

  const progress = await prisma.progress.create({
    data: {
      bookId: book.id,
      userId: b.id,
      anchor: JSON.stringify({ type: "epub-cfi", cfi: "/6/2" }),
      percent: 0.4,
    },
  });

  return {
    userA: a.id,
    userB: b.id,
    bookId: book.id,
    noteOfB: note.id,
    highlightOfB: highlight.id,
    progressOfB: progress.id,
  };
}
