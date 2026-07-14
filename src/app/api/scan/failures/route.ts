import { NextResponse } from "next/server";
import path from "node:path";
import { prisma } from "@/lib/prisma";
import { withUser } from "@/lib/route-helpers";
import { explainImportFailure } from "@/lib/scanner/failure-hints";

// GET /api/scan/failures — list books that failed to import, newest first.
//
// Session-gated (ROBUST-05 surface): any signed-in reader may see that a book
// failed, so the library doesn't silently lose files. Signed-out → 401.
//
// Privacy (T-03-07): the row stores the full filesystem path server-side, but
// the response exposes only path.basename(filePath) as `name`. The full path —
// which on a homelab is a home-directory path — never reaches the client.
export const GET = withUser(async () => {
  const rows = await prisma.failedImport.findMany({
    where: { dismissed: false },
    orderBy: { createdAt: "desc" },
  });

  const failures = rows.map((row) => {
    const name = path.basename(row.filePath);
    return {
      id: row.id,
      // basename ONLY — never the full path (privacy: no home-dir paths client-side)
      name,
      reason: row.error,
      format: row.format,
      failedAt: row.createdAt,
      // Plain-language meaning + way out (lib/scanner/failure-hints);
      // the command uses the basename, to be run in the file's folder.
      hint: explainImportFailure(row.error, row.format, name),
    };
  });

  return NextResponse.json({ failures });
});
