import { NextResponse } from "next/server";
import { walkAndScan } from "@/lib/scanner";
import { markFullScan, watcherStatus } from "@/lib/scanner/watcher";
import { enabledLocationPaths, listScanLocations, touchScanLocation } from "@/lib/scanner/locations";

// POST /api/scan — manual full-tree walk of every enabled library. Idempotent.
export async function POST() {
  const locations = await listScanLocations();
  const enabled = locations.filter((l) => l.enabled);

  const startedAt = Date.now();
  let scanned = 0;
  let errors = 0;
  try {
    for (const loc of enabled) {
      const result = await walkAndScan(loc.path);
      scanned += result.scanned;
      errors += result.errors;
      await touchScanLocation(loc.id);
    }
    markFullScan();
    return NextResponse.json({
      ok: true,
      libraries: enabled.map((l) => l.path),
      scanned,
      errors,
      durationMs: Date.now() - startedAt,
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}

// GET /api/scan — status payload, for convenience.
export async function GET() {
  const paths = await enabledLocationPaths();
  return NextResponse.json({ ...watcherStatus(), configuredPaths: paths });
}
