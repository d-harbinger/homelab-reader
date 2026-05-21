import fs from "node:fs/promises";
import path from "node:path";

// Serve the pdfjs worker file that react-pdf's bundled pdfjs needs.
// We resolve from node_modules at request time rather than copying it
// to /public, because:
//   - dev runs from this repo (no build step that would copy assets)
//   - Next.js standalone output handles /api/ routes uniformly
//   - serving the file twice (here + /public) risks version drift
//
// react-pdf nests its own pdfjs-dist when the root pin (5.6.205 for
// pdf-to-img compat) doesn't match — so we check the nested copy first.
const WORKER_CANDIDATES = [
  "node_modules/react-pdf/node_modules/pdfjs-dist/build/pdf.worker.min.mjs",
  "node_modules/pdfjs-dist/build/pdf.worker.min.mjs",
];

export async function GET() {
  for (const candidate of WORKER_CANDIDATES) {
    const full = path.resolve(candidate);
    try {
      const bytes = await fs.readFile(full);
      return new Response(new Uint8Array(bytes), {
        headers: {
          "Content-Type": "text/javascript",
          "Cache-Control": "public, max-age=31536000, immutable",
        },
      });
    } catch {
      // try next candidate
    }
  }
  return new Response("pdfjs worker not found", { status: 500 });
}
