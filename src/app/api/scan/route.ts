import { NextResponse } from "next/server";
import { withAdmin, withUser } from "@/lib/route-helpers";
import { redactWatcherStatus } from "@/lib/scanner/status-privacy";
import { walkAndScan } from "@/lib/scanner";
import { backfillGenres } from "@/lib/library/genre-backfill";
import { markFullScan, watcherStatus } from "@/lib/scanner/watcher";
import { enabledLocationPaths, listScanLocations, touchScanLocation } from "@/lib/scanner/locations";

// POST /api/scan — manual full-tree walk of every enabled library. Idempotent.
// Admin only — triggering a rescan is a privileged action.
export const POST = withAdmin(async () => {
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
    // Shelve anything still Unsorted whose subjects (stored as tags)
    // now classify — fills NULL genres only, never owner-set shelves.
    // Best-effort by contract, like enrichment: a failed backfill must
    // never fail the scan that just succeeded.
    let genresAssigned = 0;
    try {
      genresAssigned = await backfillGenres();
    } catch (err) {
      console.error("[scan] genre backfill failed:", err);
    }
    return NextResponse.json({
      ok: true,
      libraries: enabled.map((l) => l.path),
      scanned,
      errors,
      genresAssigned,
      durationMs: Date.now() - startedAt,
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
});

// GET /api/scan — status payload, for convenience.
//
// Signed-in only, and path-private for anyone who is not an admin. The library
// roots are absolute filesystem paths on the server; on a homelab those are
// home-directory paths, and a `reader` account has no business reading the
// operator's directory layout. Admins already browse those paths in Settings,
// so they still get them; everyone else gets counts. The sibling
// /api/library/folders takes the same line.
export const GET = withUser(async (user) => {
  const isAdmin = user.role === "admin";
  const paths = await enabledLocationPaths();
  return NextResponse.json({
    ...redactWatcherStatus(watcherStatus(), isAdmin),
    ...(isAdmin
      ? { configuredPaths: paths }
      : { configuredCount: paths.length }),
  });
});
