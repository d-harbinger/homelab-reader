-- Bind a note to its highlight (Slice 2b). Purely additive: a nullable
-- "highlightId" column on Note + an index + a SetNull FK to Highlight. No data
-- backfill — existing notes keep highlightId NULL and pair via the CFI fallback.
--
-- HAND-WRITTEN (not `prisma migrate dev`): follows the in-repo precedent for an
-- additive migration committed with the schema. SQLite cannot add a REFERENCES
-- constraint to an existing table via ALTER TABLE, so this uses the standard
-- Prisma SQLite table-rebuild: create a new table with the FK, copy rows, drop
-- the old, rename, and re-create every index — wrapped in foreign_keys=OFF/ON.
PRAGMA foreign_keys=OFF;

-- RedefineTables
CREATE TABLE "new_Note" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "bookId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "anchor" TEXT NOT NULL,
    "context" TEXT,
    "body" TEXT NOT NULL,
    "highlightId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Note_bookId_fkey" FOREIGN KEY ("bookId") REFERENCES "Book" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Note_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Note_highlightId_fkey" FOREIGN KEY ("highlightId") REFERENCES "Highlight" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Note" ("id", "bookId", "userId", "anchor", "context", "body", "createdAt", "updatedAt") SELECT "id", "bookId", "userId", "anchor", "context", "body", "createdAt", "updatedAt" FROM "Note";
DROP TABLE "Note";
ALTER TABLE "new_Note" RENAME TO "Note";
CREATE INDEX "Note_bookId_idx" ON "Note"("bookId");
CREATE INDEX "Note_highlightId_idx" ON "Note"("highlightId");

PRAGMA foreign_keys=ON;
