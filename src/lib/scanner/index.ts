import fs from "node:fs/promises";
import path from "node:path";
import { prisma } from "@/lib/prisma";
import { fileHash } from "./hash";
import { extractEpub } from "./epub";
import { extractPdf } from "./pdf";
import { writeCover } from "./covers";
import { enrichBook, isThin } from "@/lib/metadata/enrich";
import { classifyGenre } from "@/lib/library/genre-taxonomy";
import { onlineLookupsEnabled } from "@/lib/app-settings";
import { clearFailedImport, recordFailedImport } from "./failed-imports";

export type BookFormat = "epub" | "pdf";

export function isBookFile(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return ext === ".epub" || ext === ".pdf";
}

function formatOf(filePath: string): BookFormat | null {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".epub") return "epub";
  if (ext === ".pdf") return "pdf";
  return null;
}

// scanFile is the single entry point for "this file changed on disk, deal
// with it." Idempotent — safe to call on already-known files.
//
// Flow:
//   1. Hash the file.
//   2. If hash matches an existing Book → update path if the file moved,
//      then bail. Notes/highlights/progress are preserved this way.
//   3. If path matches an existing Book with a different hash → file
//      contents changed; re-extract metadata, keep the Book row + notes.
//   4. Otherwise → new file. Extract metadata, create Book + Authors,
//      write cover.
export async function scanFile(filePath: string): Promise<void> {
  const format = formatOf(filePath);
  if (!format) return;

  let stat;
  try {
    stat = await fs.stat(filePath);
  } catch {
    // Race: file was removed between watcher fire and our stat. Let the
    // unlink handler take care of it.
    return;
  }
  if (!stat.isFile()) return;

  const hash = await fileHash(filePath);

  // Resolve by PATH first. This ordering is load-bearing: the only filePath-
  // mutating write below is the move-repoint, and checking the path first
  // guarantees it can never target a path another row already owns (such a path
  // resolves here instead). The old code matched by hash first and always
  // repointed, which crashed when two identical files coexisted — the update
  // tried to claim an occupied filePath ("Unique constraint failed on filePath").
  const byPath = await prisma.book.findUnique({ where: { filePath } });
  if (byPath) {
    if (byPath.fileHash === hash) {
      // Known file, unchanged since last scan.
      return;
    }
    // Content changed in place. Re-extract; keep the Book.id (and
    // notes/highlights/progress linked to it).
    const extracted = await extractFor(format, filePath);
    await prisma.book.update({
      where: { id: byPath.id },
      data: {
        fileHash: hash,
        fileSizeBytes: stat.size,
        title: extracted.title || byPath.title,
        subtitle: extracted.subtitle ?? byPath.subtitle,
        language: extracted.language ?? byPath.language,
        publisher: extracted.publisher ?? byPath.publisher,
        publishedAt: extracted.publishedAt ?? byPath.publishedAt,
        description: extracted.description ?? byPath.description,
        isbn: extracted.isbn ?? byPath.isbn,
        pageCount: extracted.pageCount ?? byPath.pageCount,
        // Fill-only: a shelf the owner set (or a previous classification)
        // is never overwritten by a re-extract.
        genre: byPath.genre ?? classifyGenre(extracted.subjects),
        scannedAt: new Date(),
      },
    });
    if (extracted.cover) {
      const coverFile = await writeCover(
        byPath.id,
        extracted.cover.buffer,
        extracted.cover.ext,
      );
      await prisma.book.update({
        where: { id: byPath.id },
        data: { coverPath: coverFile },
      });
    }
    return;
  }

  // No row at this path, but a book with identical content may exist — the file
  // was renamed/moved. Repoint that row so notes/highlights/progress follow the
  // file (preserving them across a rename, as before). This is now crash-safe:
  // we only get here when `filePath` is unoccupied (byPath was null above), so
  // the update can never collide with another row's unique filePath. Two
  // duplicate files therefore converge on one row instead of crashing.
  const byHash = await prisma.book.findFirst({ where: { fileHash: hash } });
  if (byHash) {
    await prisma.book.update({
      where: { id: byHash.id },
      data: { filePath, scannedAt: new Date() },
    });
    return;
  }

  // New file path. Extract metadata, then insert.
  const extracted = await extractFor(format, filePath);
  const fallbackTitle = path.basename(filePath, path.extname(filePath));

  const book = await prisma.book.create({
    data: {
      filePath,
      fileHash: hash,
      fileSizeBytes: stat.size,
      format,
      title: extracted.title || fallbackTitle,
      subtitle: extracted.subtitle,
      language: extracted.language,
      publisher: extracted.publisher,
      publishedAt: extracted.publishedAt,
      description: extracted.description,
      isbn: extracted.isbn,
      pageCount: extracted.pageCount,
      // Bookstore shelf from the embedded subjects (lib/library/
      // genre-taxonomy). Null = Unsorted; the OpenLibrary enrichment
      // accept path and the rescan backfill get later chances to fill it.
      genre: classifyGenre(extracted.subjects),
      authors: {
        connectOrCreate: extracted.authors.map((name) => ({
          where: { name },
          create: { name },
        })),
      },
      tags: {
        connectOrCreate: extracted.subjects.map((name) => ({
          where: { name },
          create: { name },
        })),
      },
    },
  });

  if (extracted.cover) {
    const coverFile = await writeCover(
      book.id,
      extracted.cover.buffer,
      extracted.cover.ext,
    );
    await prisma.book.update({
      where: { id: book.id },
      data: { coverPath: coverFile },
    });
  }

  // Enrich-on-import (D3): a freshly imported book whose embedded metadata is
  // thin gets ranked OpenLibrary suggestions stored against it for the owner to
  // review. Best-effort by contract — a thrown/failed enrich must NEVER break
  // the import (the book is already created above), so this is fenced and
  // swallows. Only runs on the brand-new-file branch: a re-extract / move keeps
  // the owner's earlier suggestion decisions (D-3e).
  await enrichNewBook(
    { id: book.id, title: book.title, isbn: book.isbn },
    filePath,
    extracted.authors,
  );
}

// Map the in-memory MetadataSuggestion pipeline onto persisted BookSuggestion
// rows for a just-created thin book. The fetch is read from the global at call
// time so tests can inject canned OpenLibrary JSON via vi.stubGlobal("fetch", …)
// without forking scanFile's signature (the watcher calls scanFile(path) only).
//
// Best-effort: every failure path — a thin-check throw, a network failure inside
// enrichBook (which itself resolves to []), or a DB write error — is swallowed.
// The import has already succeeded; enrichment never regresses that.
async function enrichNewBook(
  book: { id: string; title: string; isbn: string | null },
  filePath: string,
  authorNames: string[],
): Promise<void> {
  try {
    // Consent gate: enrichment talks to OpenLibrary, and this install
    // may not have opted into online lookups (default off — the
    // setup-time privacy choice, changeable in Settings → Privacy).
    if (!(await onlineLookupsEnabled())) return;
    const thin = isThin({
      title: book.title,
      filePath,
      isbn: book.isbn,
      authors: authorNames.map((name) => ({ name })),
    });
    if (!thin) return;

    const suggestions = await enrichBook(filePath, globalThis.fetch);
    if (suggestions.length === 0) return;

    // Map MetadataSuggestion (in-memory) → BookSuggestion columns: string[]
    // (authors/subjects) become JSON strings (SQLite has no array type);
    // undefined optionals become null. status defaults to "pending".
    await prisma.bookSuggestion.createMany({
      data: suggestions.map((s) => ({
        bookId: book.id,
        source: s.source,
        confidence: s.confidence,
        title: s.title ?? null,
        authors: JSON.stringify(s.authors),
        publishedYear: s.publishedYear ?? null,
        publisher: s.publisher ?? null,
        isbn: s.isbn ?? null,
        subjects: JSON.stringify(s.subjects),
        coverUrl: s.coverUrl ?? null,
        workKey: s.workKey ?? null,
      })),
    });
  } catch {
    // Swallow — enrichment is best-effort and must never break an import.
  }
}

interface ExtractedCommon {
  title?: string;
  subtitle?: string;
  authors: string[];
  language?: string;
  publisher?: string;
  description?: string;
  publishedAt?: Date;
  isbn?: string;
  pageCount?: number;
  subjects: string[];
  cover?: { buffer: Buffer; ext: string };
}

async function extractFor(
  format: BookFormat,
  filePath: string,
): Promise<ExtractedCommon> {
  if (format === "epub") {
    const e = await extractEpub(filePath);
    return {
      title: e.title,
      authors: e.authors,
      language: e.language,
      publisher: e.publisher,
      description: e.description,
      publishedAt: e.publishedAt,
      isbn: e.isbn,
      subjects: e.subjects,
      cover: e.cover,
    };
  }
  const p = await extractPdf(filePath);
  return {
    title: p.title,
    authors: p.authors,
    language: p.language,
    publisher: p.publisher,
    publishedAt: p.publishedAt,
    pageCount: p.pageCount,
    subjects: [],
    cover: p.cover,
  };
}

// Called by the watcher when a file is removed from the library.
//
// v1 deletes the Book row (and cascades notes/highlights/progress). A
// later phase may add a `missingAt` column so notes survive accidental
// deletes / volume remounts, but the current schema favors simplicity.
export async function removeFileFromLibrary(filePath: string): Promise<void> {
  await prisma.book.deleteMany({ where: { filePath } });
}

// Manual full-tree walk. Used by the API trigger and as a fallback on
// startup if a user disables chokidar polling. scanFile is idempotent, so
// running this against a fully-scanned library is cheap (just hashes).
export async function walkAndScan(
  root: string,
): Promise<{ scanned: number; errors: number }> {
  const stats = { scanned: 0, errors: 0 };

  async function walk(dir: string) {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch (err) {
      console.error(`[scanner] readdir failed at ${dir}`, err);
      stats.errors++;
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.isFile() && isBookFile(full)) {
        try {
          await scanFile(full);
          stats.scanned++;
          // Succeeded — drop any prior failure record, same contract as the
          // watcher path: a fixed book stops being reported.
          await clearFailedImport(full);
        } catch (err) {
          console.error(`[scanner] scan failed for ${full}`, err);
          stats.errors++;
          // Record a visible FailedImport — previously only the watcher did
          // this, so a book failing during a manual rescan never surfaced in
          // the banner (it only bumped a counter nobody rendered).
          await recordFailedImport(full, formatOf(full) ?? "epub", err).catch(
            (recErr) =>
              console.error(`[scanner] recordFailedImport failed: ${full}`, recErr),
          );
        }
      }
    }
  }

  await walk(root);
  return stats;
}
