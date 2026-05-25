import { NextResponse } from "next/server";
import {
  ForbiddenError,
  requireAdmin,
  UnauthenticatedError,
} from "@/lib/current-user";
import {
  addScanLocation,
  listScanLocations,
  LocationError,
} from "@/lib/scanner/locations";
import { walkAndScan } from "@/lib/scanner";
import { restartWatcher } from "@/lib/scanner/watcher";

export function authError(e: unknown): NextResponse {
  if (e instanceof UnauthenticatedError) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  if (e instanceof ForbiddenError) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  throw e;
}

// GET /api/locations — list configured library folders (admin only).
export async function GET() {
  try {
    await requireAdmin();
  } catch (e) {
    return authError(e);
  }
  return NextResponse.json({ locations: await listScanLocations() });
}

// POST /api/locations — add a library folder, scan it, and start watching it.
// Body: { path }
export async function POST(req: Request) {
  try {
    await requireAdmin();
  } catch (e) {
    return authError(e);
  }

  let body: { path?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  if (!body.path) {
    return NextResponse.json({ error: "missing path" }, { status: 400 });
  }

  let location;
  try {
    location = await addScanLocation(body.path);
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
}
