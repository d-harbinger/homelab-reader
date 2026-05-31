import { NextResponse } from "next/server";
import path from "node:path";
import { prisma } from "@/lib/prisma";
import { getCurrentUser, authError, UnauthenticatedError } from "@/lib/current-user";

// GET /api/scan/failures — list books that failed to import, newest first.
//
// Session-gated (ROBUST-05 surface): any signed-in reader may see that a book
// failed, so the library doesn't silently lose files. Signed-out → 401.
//
// Privacy (T-03-07): the row stores the full filesystem path server-side, but
// the response exposes only path.basename(filePath) as `name`. The full path —
// which on a homelab is a home-directory path — never reaches the client.
export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) return authError(new UnauthenticatedError());

    const rows = await prisma.failedImport.findMany({
      orderBy: { createdAt: "desc" },
    });

    const failures = rows.map((row) => ({
      id: row.id,
      // basename ONLY — never the full path (privacy: no home-dir paths client-side)
      name: path.basename(row.filePath),
      reason: row.error,
      format: row.format,
      failedAt: row.createdAt,
    }));

    return NextResponse.json({ failures });
  } catch (e) {
    return authError(e);
  }
}
