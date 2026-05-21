// Copy react-pdf's bundled pdfjs worker into /public so it's served as a
// static asset (and survives `next build --output standalone`, which only
// includes files webpack actually traced).
//
// Runs from package.json's prebuild hook.

import { copyFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";

const CANDIDATES = [
  "node_modules/react-pdf/node_modules/pdfjs-dist/build/pdf.worker.min.mjs",
  "node_modules/pdfjs-dist/build/pdf.worker.min.mjs",
];

const src = CANDIDATES.find((p) => existsSync(p));
if (!src) {
  console.error(
    "[copy-pdfjs-worker] not found — react-pdf may not be installed",
  );
  process.exit(1);
}

await mkdir("public", { recursive: true });
await copyFile(src, "public/pdf.worker.min.mjs");
console.log(`[copy-pdfjs-worker] ${src} → public/pdf.worker.min.mjs`);
