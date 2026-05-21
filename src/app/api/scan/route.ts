import { NextResponse } from "next/server";
import { walkAndScan } from "@/lib/scanner";
import { markFullScan, watcherStatus } from "@/lib/scanner/watcher";

// POST /api/scan — manual full-tree walk. Idempotent.
export async function POST() {
  const booksPath = process.env.BOOKS_PATH || "./books";

  const startedAt = Date.now();
  try {
    const result = await walkAndScan(booksPath);
    markFullScan();
    return NextResponse.json({
      ok: true,
      booksPath,
      scanned: result.scanned,
      errors: result.errors,
      durationMs: Date.now() - startedAt,
    });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
        booksPath,
      },
      { status: 500 },
    );
  }
}

// GET /api/scan — same payload shape as status, for convenience.
export async function GET() {
  return NextResponse.json(watcherStatus());
}
