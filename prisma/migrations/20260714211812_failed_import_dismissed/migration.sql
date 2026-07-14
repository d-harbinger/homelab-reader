-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_FailedImport" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "filePath" TEXT NOT NULL,
    "format" TEXT NOT NULL,
    "error" TEXT NOT NULL,
    "dismissed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_FailedImport" ("createdAt", "error", "filePath", "format", "id") SELECT "createdAt", "error", "filePath", "format", "id" FROM "FailedImport";
DROP TABLE "FailedImport";
ALTER TABLE "new_FailedImport" RENAME TO "FailedImport";
CREATE UNIQUE INDEX "FailedImport_filePath_key" ON "FailedImport"("filePath");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
