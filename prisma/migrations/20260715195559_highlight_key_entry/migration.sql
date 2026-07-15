-- CreateTable
CREATE TABLE "HighlightKeyEntry" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "bookId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "color" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "HighlightKeyEntry_bookId_fkey" FOREIGN KEY ("bookId") REFERENCES "Book" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "HighlightKeyEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "HighlightKeyEntry_bookId_userId_color_key" ON "HighlightKeyEntry"("bookId", "userId", "color");
