import { NextResponse } from "next/server";
import { parseJson, withAdmin, type IdContext } from "@/lib/route-helpers";
import {
  removeScanLocation,
  setScanLocationEnabled,
} from "@/lib/scanner/locations";
import { restartWatcher } from "@/lib/scanner/watcher";

// PATCH /api/locations/[id] — enable/disable a library. Body: { enabled }
export const PATCH = withAdmin<IdContext>(async (_admin, req, { params }) => {
  const { id } = await params;

  const parsed = await parseJson<{ enabled?: boolean }>(req);
  if (!parsed.ok) return parsed.res;
  if (typeof parsed.body.enabled !== "boolean") {
    return NextResponse.json({ error: "missing enabled" }, { status: 400 });
  }

  await setScanLocationEnabled(id, parsed.body.enabled);
  await restartWatcher();
  return new NextResponse(null, { status: 204 });
});

// DELETE /api/locations/[id] — stop watching a folder and drop its books.
export const DELETE = withAdmin<IdContext>(async (_admin, _req, { params }) => {
  const { id } = await params;

  const removed = await removeScanLocation(id);
  if (!removed) return new NextResponse(null, { status: 404 });
  await restartWatcher();
  return new NextResponse(null, { status: 204 });
});
