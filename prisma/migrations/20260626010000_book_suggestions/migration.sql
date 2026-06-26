-- CreateTable: ranked OpenLibrary metadata candidates proposed for a Book at
-- scan time (D3 enrich-on-import, Slice 1). Purely additive — a brand-new table
-- with no backfill and no rebuild of an existing one, so a plain CREATE TABLE +
-- two indexes suffice (no PRAGMA foreign_keys=OFF table-swap, unlike the
-- note_highlight_fk migration which had to add a constraint to an existing
-- table).
--
-- HAND-WRITTEN (not `prisma migrate dev`): follows the in-repo precedent for an
-- additive migration committed alongside the schema (see 20260601000000_failed_imports).
-- Timestamp ordered after 20260626000000_note_highlight_fk.
--
-- authors / subjects are JSON-encoded string[] (SQLite has no array type); the
-- scan hook maps the in-memory MetadataSuggestion shape onto these columns.
CREATE TABLE "BookSuggestion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "bookId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "confidence" REAL NOT NULL,
    "title" TEXT,
    "authors" TEXT NOT NULL,
    "publishedYear" INTEGER,
    "publisher" TEXT,
    "isbn" TEXT,
    "subjects" TEXT NOT NULL,
    "coverUrl" TEXT,
    "workKey" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BookSuggestion_bookId_fkey" FOREIGN KEY ("bookId") REFERENCES "Book" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "BookSuggestion_bookId_idx" ON "BookSuggestion"("bookId");

-- CreateIndex
CREATE INDEX "BookSuggestion_status_idx" ON "BookSuggestion"("status");
