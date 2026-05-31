import { NextResponse } from "next/server";
import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { prisma } from "@/lib/prisma";

const MIME: Record<string, string> = {
  epub: "application/epub+zip",
  pdf: "application/pdf",
};

interface ByteRange {
  start: number;
  end: number; // inclusive
}

// Parse a single-range HTTP Range header into clamped, inclusive byte offsets.
//
// Untrusted input (T-03-06): we never feed unchecked header arithmetic to
// createReadStream. The header is parsed defensively and the offsets are
// validated against the file size before use.
//
// Returns:
//   - a ByteRange for a satisfiable single range (start/end clamped to the file)
//   - "unsatisfiable" when the range names a start past the end of the file
//     (or an inverted start>end), which the caller answers with a 416
//   - null when there is no range, the header is malformed, or it is a
//     multi-range request — the caller then serves the whole file (200)
function parseRange(
  header: string | null,
  size: number,
): ByteRange | "unsatisfiable" | null {
  if (!header) return null;

  // Only "bytes=" ranges are supported; anything else → full file.
  const match = /^bytes=(.*)$/.exec(header.trim());
  if (!match) return null;

  const spec = match[1].trim();
  // Multi-range ("bytes=0-9,20-29") is not supported — serve the whole file.
  if (spec.includes(",")) return null;

  const dash = spec.indexOf("-");
  if (dash < 0) return null;

  const startStr = spec.slice(0, dash).trim();
  const endStr = spec.slice(dash + 1).trim();

  // An empty file can satisfy no range.
  if (size === 0) return "unsatisfiable";

  // Suffix range: "bytes=-n" → the last n bytes.
  if (startStr === "") {
    if (endStr === "") return null; // "bytes=-" is malformed
    const suffix = Number(endStr);
    if (!Number.isInteger(suffix) || suffix < 0) return null;
    if (suffix === 0) return "unsatisfiable"; // last 0 bytes is empty
    // W-3 (RFC 7233): a suffix asking for >= the whole file clamps to the
    // entire file rather than returning 416.
    const start = suffix >= size ? 0 : size - suffix;
    return { start, end: size - 1 };
  }

  const start = Number(startStr);
  if (!Number.isInteger(start) || start < 0) return null;

  // Start at or past EOF → unsatisfiable (416).
  if (start >= size) return "unsatisfiable";

  // "bytes=a-" → from start to the end of the file.
  if (endStr === "") return { start, end: size - 1 };

  const end = Number(endStr);
  if (!Number.isInteger(end) || end < 0) return null;
  if (end < start) return "unsatisfiable"; // inverted range

  // Clamp the inclusive end to the last byte.
  return { start, end: Math.min(end, size - 1) };
}

// Adapt a Node Readable into a web ReadableStream for the Response body.
function toWebStream(stream: Readable): ReadableStream<Uint8Array> {
  return Readable.toWeb(stream) as unknown as ReadableStream<Uint8Array>;
}

// GET /api/books/[id]/file — stream the source file bytes. Used by:
// - The browser's native PDF viewer (when a PDF book is "opened")
// - The EPUB reader, which fetches the bytes to feed epub.js
// - android-reader over OPDS, which may issue Range requests
//
// Streams from disk (createReadStream) instead of buffering the whole file
// into memory (T-03-05), and honors HTTP Range requests with 206/416 (ROBUST-03).
//
// Path-escape defended: we only serve files whose absolute path was
// recorded in the DB by the scanner; we don't accept user-supplied paths
// (T-03-08 — path.resolve(book.filePath), never a request path).
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const book = await prisma.book.findUnique({ where: { id } });
  if (!book) return new NextResponse(null, { status: 404 });

  const filePath = path.resolve(book.filePath);

  let size: number;
  try {
    const stat = await fs.stat(filePath);
    if (!stat.isFile()) return new NextResponse(null, { status: 404 });
    size = stat.size;
  } catch {
    return new NextResponse(null, { status: 404 });
  }

  const mime = MIME[book.format] ?? "application/octet-stream";
  const safeName = encodeURIComponent(
    `${book.title}.${book.format}`.replace(/[/\\]/g, "_"),
  );

  const baseHeaders: Record<string, string> = {
    "Content-Type": mime,
    // inline so PDFs render in the browser tab; EPUBs get the same
    // disposition (browser ignores it for fetch'd binary blobs)
    "Content-Disposition": `inline; filename*=UTF-8''${safeName}`,
    "Cache-Control": "private, max-age=3600",
    "Accept-Ranges": "bytes",
  };

  const range = parseRange(req.headers.get("range"), size);

  // Unsatisfiable range → 416 with Content-Range: bytes */size.
  if (range === "unsatisfiable") {
    return new NextResponse(null, {
      status: 416,
      headers: {
        ...baseHeaders,
        "Content-Range": `bytes */${size}`,
      },
    });
  }

  // Satisfiable single range → 206 Partial Content.
  if (range) {
    const { start, end } = range;
    const length = end - start + 1;
    const stream = createReadStream(filePath, { start, end });
    return new NextResponse(toWebStream(stream), {
      status: 206,
      headers: {
        ...baseHeaders,
        "Content-Range": `bytes ${start}-${end}/${size}`,
        "Content-Length": String(length),
      },
    });
  }

  // No / unparseable / multi-range header → full file streamed (200).
  const stream = createReadStream(filePath);
  return new NextResponse(toWebStream(stream), {
    status: 200,
    headers: {
      ...baseHeaders,
      "Content-Length": String(size),
    },
  });
}
