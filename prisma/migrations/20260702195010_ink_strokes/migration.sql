-- CreateTable
CREATE TABLE "InkStroke" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "bookId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "page" INTEGER NOT NULL,
    "path" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#1c1c1e',
    "width" REAL NOT NULL DEFAULT 6,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "InkStroke_bookId_fkey" FOREIGN KEY ("bookId") REFERENCES "Book" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "InkStroke_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "InkStroke_bookId_userId_idx" ON "InkStroke"("bookId", "userId");
