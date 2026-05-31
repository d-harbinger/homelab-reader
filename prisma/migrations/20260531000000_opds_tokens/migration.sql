-- CreateTable: per-user OPDS API tokens, hashed at rest (store the hash, never the token)
CREATE TABLE "OpdsToken" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" DATETIME,
    CONSTRAINT "OpdsToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "OpdsToken_tokenHash_key" ON "OpdsToken"("tokenHash");

-- CreateIndex
CREATE INDEX "OpdsToken_userId_idx" ON "OpdsToken"("userId");
