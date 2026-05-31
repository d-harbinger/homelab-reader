import { prisma } from "@/lib/prisma";
import type { BookFormat } from "./index";

// Cap on the stored error message. The full message may carry a path or other
// detail that doesn't belong in a row the UI surfaces, and we only need enough
// to tell one failure reason from another. Truncate (don't drop) so the reason
// stays human-readable.
const MAX_ERROR_LEN = 500;

function errorMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  return raw.length > MAX_ERROR_LEN ? raw.slice(0, MAX_ERROR_LEN) : raw;
}

// Record (or refresh) a failed import for a path. Upsert by filePath so a file
// that keeps failing on every rescan stays a single row with the latest reason
// and timestamp, rather than accumulating duplicates.
export async function recordFailedImport(
  filePath: string,
  format: BookFormat,
  err: unknown,
): Promise<void> {
  const message = errorMessage(err);
  await prisma.failedImport.upsert({
    where: { filePath },
    create: { filePath, format, error: message },
    update: { format, error: message, createdAt: new Date() },
  });
}

// Clear any failed-import row for a path — called when the file imports
// successfully or is removed from the library. deleteMany is a no-op (no throw)
// when there's no matching row, so callers don't have to check first.
export async function clearFailedImport(filePath: string): Promise<void> {
  await prisma.failedImport.deleteMany({ where: { filePath } });
}
