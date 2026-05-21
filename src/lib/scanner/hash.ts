import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";

// SHA-256 of the file's bytes. Used to detect renames vs. new files so we
// preserve notes/highlights/progress when a book moves within the library.
//
// Full-content hash is O(filesize) — fine for the homelab volume (tens of
// thousands of books at most). If this ever becomes a bottleneck, switch to
// a size + head/tail sample hash, but full-hash is what avoids surprises
// when the user re-downloads a book they already had under a different
// filename.
export async function fileHash(filePath: string): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const h = createHash("sha256");
    const s = createReadStream(filePath);
    s.on("data", (chunk) => h.update(chunk));
    s.on("end", () => resolve(h.digest("hex")));
    s.on("error", reject);
  });
}
