-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_InkStroke" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "bookId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "page" INTEGER NOT NULL,
    "path" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#1c1c1e',
    "width" REAL NOT NULL DEFAULT 4,
    "opacity" REAL NOT NULL DEFAULT 1,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "InkStroke_bookId_fkey" FOREIGN KEY ("bookId") REFERENCES "Book" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "InkStroke_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_InkStroke" ("bookId", "color", "createdAt", "id", "page", "path", "userId", "width") SELECT "bookId", "color", "createdAt", "id", "page", "path", "userId", "width" FROM "InkStroke";
DROP TABLE "InkStroke";
ALTER TABLE "new_InkStroke" RENAME TO "InkStroke";
CREATE INDEX "InkStroke_bookId_userId_idx" ON "InkStroke"("bookId", "userId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
