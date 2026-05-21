import fs from "node:fs/promises";

export interface PdfExtraction {
  title?: string;
  authors: string[];
  language?: string;
  publisher?: string;
  publishedAt?: Date;
  pageCount: number;
}

// PDF metadata extraction via pdfjs-dist.
//
// v1 deliberately does not render a cover image — that would need a canvas
// implementation in Node (node-canvas / @napi-rs/canvas), and the heavy
// native deps don't pull their weight before the UI is even sketched. PDF
// covers can be added in a later phase; until then, the UI falls back to a
// placeholder for the PDF format badge.
export async function extractPdf(filePath: string): Promise<PdfExtraction> {
  // pdfjs-dist v5 ships ESM; the legacy build is more forgiving on Node
  // runtimes that haven't gotten newer Web APIs.
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");

  const buffer = await fs.readFile(filePath);
  // Copy into a fresh Uint8Array — pdfjs takes ownership.
  const data = new Uint8Array(buffer);

  const loadingTask = pdfjs.getDocument({
    data,
    disableFontFace: true,
    // We don't render; suppress worker setup noise.
    useWorkerFetch: false,
    useSystemFonts: false,
  });

  const doc = await loadingTask.promise;
  try {
    const md = await doc.getMetadata().catch(() => null);
    const info = (md?.info ?? {}) as Record<string, unknown>;

    const title = strOrUndef(info.Title);
    const rawAuthor = strOrUndef(info.Author);
    const authors = rawAuthor
      ? rawAuthor
          .split(/[,;]| and /i)
          .map((s) => s.trim())
          .filter(Boolean)
      : [];

    const language = strOrUndef(info.Language);
    const publisher = strOrUndef(info.Producer) ?? strOrUndef(info.Creator);

    const dateStr = strOrUndef(info.CreationDate);
    const publishedAt = dateStr ? parsePdfDate(dateStr) : undefined;

    return {
      title,
      authors,
      language,
      publisher,
      publishedAt,
      pageCount: doc.numPages,
    };
  } finally {
    await doc.destroy();
  }
}

function strOrUndef(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t || undefined;
}

// PDF dates look like:  D:YYYYMMDDHHmmSSOHH'mm'   (or simpler suffixes).
// We accept the common prefixes and ignore the timezone offset detail —
// good enough for "year published" display.
function parsePdfDate(s: string): Date | undefined {
  const m = /^D:(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?/.exec(s);
  if (!m) return undefined;
  const [, y, mo = "01", d = "01", h = "00", mi = "00", se = "00"] = m;
  const date = new Date(
    Date.UTC(
      parseInt(y, 10),
      parseInt(mo, 10) - 1,
      parseInt(d, 10),
      parseInt(h, 10),
      parseInt(mi, 10),
      parseInt(se, 10),
    ),
  );
  return isNaN(date.getTime()) ? undefined : date;
}
