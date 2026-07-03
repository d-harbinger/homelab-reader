// Delete the end-to-end SQLite database so every Playwright run starts from a
// known-empty schema. The database path is derived from DATABASE_URL (a `file:`
// URL supplied by the Playwright web-server env). As a safety rail this refuses
// to touch any path that does not clearly belong to the E2E suite, so a
// mis-set environment can never wipe a real library.
import { rmSync, mkdirSync } from "node:fs";
import path from "node:path";

const url = process.env.DATABASE_URL ?? "";
const match = /^file:(.*?)(\?.*)?$/.exec(url);
if (!match) {
  console.error(`[e2e reset-db] DATABASE_URL is not a file: URL: ${url}`);
  process.exit(1);
}

const dbPath = match[1];
if (!/e2e/.test(dbPath)) {
  console.error(
    `[e2e reset-db] refusing to delete a database whose path is not marked e2e: ${dbPath}`,
  );
  process.exit(1);
}

for (const suffix of ["", "-wal", "-shm", "-journal"]) {
  rmSync(dbPath + suffix, { force: true });
}

// The database lives outside the repo (see playwright.config.ts); make sure its
// parent directory exists so `prisma migrate deploy` can create the file.
mkdirSync(path.dirname(dbPath), { recursive: true });

console.log(`[e2e reset-db] cleared ${dbPath}`);
