import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

// Apply SQLite connection PRAGMAs once at server boot.
//
// WAL (write-ahead logging) lets readers and a single writer proceed
// concurrently instead of taking a whole-database lock — the standard fix for
// "database is locked" under a reader + background-scanner-writer workload.
// busy_timeout makes a contending statement wait (here 5s) for a held write
// lock to clear rather than failing immediately with SQLITE_BUSY.
//
// Each PRAGMA is wrapped independently: a non-SQLite datasource, a read-only
// mount, or any PRAGMA failure logs a warning and is skipped rather than
// crashing boot. WAL is durable in the database file, so re-applying it on
// every boot is cheap and idempotent.
//
// Use $queryRawUnsafe, NOT $executeRawUnsafe: `PRAGMA journal_mode=WAL` RETURNS a
// row (the resulting mode), and $executeRawUnsafe rejects any result-returning
// statement ("Execute returned results, which is not allowed in SQLite") — which
// silently no-op'd WAL on every boot. $queryRawUnsafe accepts both row-returning
// and silent PRAGMAs.
export async function applySqlitePragmas(): Promise<void> {
  const pragmas = [
    "PRAGMA journal_mode=WAL",
    "PRAGMA busy_timeout=5000",
  ];
  for (const pragma of pragmas) {
    try {
      await prisma.$queryRawUnsafe(pragma);
    } catch (err) {
      console.warn(
        `[prisma] skipped "${pragma}":`,
        (err as Error).message,
      );
    }
  }
}
