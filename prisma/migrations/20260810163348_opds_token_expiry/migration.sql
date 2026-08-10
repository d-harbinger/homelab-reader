/*
  OPDS tokens gain a required `expiresAt`.

  These tokens are password-equivalent and live on phones. Revocation already
  existed, but revocation only helps the person who remembers to use it, and a
  token on a handset that was lost or replaced is forgotten rather than revoked.
  The column is NOT NULL so that "never expires" is not a state the schema can
  represent — a row inserted by hand, by a seed, or by a restore of an older
  snapshot cannot come back as an immortal credential.

  Existing rows are backfilled with ninety days from the moment this migration
  runs, NOT from their own createdAt. Dating the window from createdAt would
  silently kill every token older than a quarter the instant this deploys, which
  turns a security fix into an outage on someone's phone. Ninety days from now
  gives every existing pairing a full, ordinary window to be renewed, while
  guaranteeing that none of them lives forever from here on.

  `datetime('now', '+90 days')` yields the same TEXT shape SQLite's
  CURRENT_TIMESTAMP already writes into createdAt in this table, so Prisma reads
  the backfilled values with the parser it already uses for that column.
*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_OpdsToken" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" DATETIME,
    "expiresAt" DATETIME NOT NULL,
    CONSTRAINT "OpdsToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_OpdsToken" ("createdAt", "id", "label", "lastUsedAt", "tokenHash", "userId", "expiresAt") SELECT "createdAt", "id", "label", "lastUsedAt", "tokenHash", "userId", datetime('now', '+90 days') FROM "OpdsToken";
DROP TABLE "OpdsToken";
ALTER TABLE "new_OpdsToken" RENAME TO "OpdsToken";
CREATE UNIQUE INDEX "OpdsToken_tokenHash_key" ON "OpdsToken"("tokenHash");
CREATE INDEX "OpdsToken_userId_idx" ON "OpdsToken"("userId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
