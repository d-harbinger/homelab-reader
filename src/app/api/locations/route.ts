import { NextResponse } from "next/server";
import { parseJson, withAdmin } from "@/lib/route-helpers";
import {
  addScanLocation,
  listScanLocations,
  LocationError,
} from "@/lib/scanner/locations";
import { walkAndScan } from "@/lib/scanner";
import { restartWatcher } from "@/lib/scanner/watcher";

// GET /api/locations — list configured library folders (admin only).
export const GET = withAdmin(async () => {
  return NextResponse.json({ locations: await listScanLocations() });
});

// POST /api/locations — add a library folder, scan it, and start watching it.
// Body: { path }
export const POST = withAdmin(async (_admin, req) => {
  const parsed = await parseJson<{ path?: string }>(req);
  if (!parsed.ok) return parsed.res;
  if (!parsed.body.path) {
    return NextResponse.json({ error: "missing path" }, { status: 400 });
  }

  let location;
  try {
    location = await addScanLocation(parsed.body.path);
  } catch (e) {
    if (e instanceof LocationError) {
      return NextResponse.json({ error: e.message }, { status: 400 });
    }
    throw e;
  }

  // Pull in what's already there, then (re)start the watcher over the new set.
  const result = await walkAndScan(location.path);
  await restartWatcher();

  return NextResponse.json(
    { location: { ...location, bookCount: result.scanned }, scanned: result.scanned },
    { status: 201 },
  );
});
