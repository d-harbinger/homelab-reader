-- CreateTable: book files the scanner could not extract (corrupt archive,
-- missing OPF, unreadable PDF). One row per failing path; cleared on a
-- successful (re)import or when the file is removed.
CREATE TABLE "FailedImport" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "filePath" TEXT NOT NULL,
    "format" TEXT NOT NULL,
    "error" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "FailedImport_filePath_key" ON "FailedImport"("filePath");
