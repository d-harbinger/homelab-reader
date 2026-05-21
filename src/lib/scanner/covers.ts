import fs from "node:fs/promises";
import path from "node:path";

// Covers live under /data/covers/ — out-of-band from the source library so
// the scanner never writes into the user's book folder.
export const COVERS_DIR = path.resolve(process.cwd(), "data", "covers");

export async function writeCover(
  bookId: string,
  buffer: Buffer,
  ext: string,
): Promise<string> {
  await fs.mkdir(COVERS_DIR, { recursive: true });
  const safeExt = ext.replace(/[^a-z0-9]/gi, "").slice(0, 5).toLowerCase() || "jpg";
  const filename = `${bookId}.${safeExt}`;
  await fs.writeFile(path.join(COVERS_DIR, filename), buffer);
  return filename;
}

export function resolveCoverPath(filename: string): string {
  // Defensive: reject anything that tries to escape COVERS_DIR.
  const full = path.resolve(COVERS_DIR, filename);
  if (!full.startsWith(COVERS_DIR + path.sep) && full !== COVERS_DIR) {
    throw new Error("cover path escape");
  }
  return full;
}
