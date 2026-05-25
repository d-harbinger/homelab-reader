import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/current-user";
import {
  removeScanLocation,
  setScanLocationEnabled,
} from "@/lib/scanner/locations";
import { restartWatcher } from "@/lib/scanner/watcher";
import { authError } from "../route";

// PATCH /api/locations/[id] — enable/disable a library. Body: { enabled }
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requireAdmin();
  } catch (e) {
    return authError(e);
  }
  const { id } = await params;

  let body: { enabled?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  if (typeof body.enabled !== "boolean") {
    return NextResponse.json({ error: "missing enabled" }, { status: 400 });
  }

  await setScanLocationEnabled(id, body.enabled);
  await restartWatcher();
  return new NextResponse(null, { status: 204 });
}

// DELETE /api/locations/[id] — stop watching a folder and drop its books.
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requireAdmin();
  } catch (e) {
    return authError(e);
  }
  const { id } = await params;

  const removed = await removeScanLocation(id);
  if (!removed) return new NextResponse(null, { status: 404 });
  await restartWatcher();
  return new NextResponse(null, { status: 204 });
}
