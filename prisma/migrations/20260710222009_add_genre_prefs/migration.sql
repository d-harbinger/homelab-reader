-- CreateTable
CREATE TABLE "GenrePref" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "displayName" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,
    "hidden" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" DATETIME NOT NULL
);
