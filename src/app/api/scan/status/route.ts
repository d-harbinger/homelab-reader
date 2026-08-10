import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withUser } from "@/lib/route-helpers";
import { watcherStatus } from "@/lib/scanner/watcher";
import { redactWatcherStatus } from "@/lib/scanner/status-privacy";

// GET /api/scan/status — the home screen's polling endpoint (every five
// seconds, for every signed-in browser).
//
// Signed-in only, and path-private below admin: `watcherStatus()` carries the
// absolute library roots, which on a homelab are home-directory paths. See
// src/lib/scanner/status-privacy.ts.
export const GET = withUser(async (user) => {
  const [bookCount, lastBook] = await Promise.all([
    prisma.book.count(),
    prisma.book.findFirst({ orderBy: { scannedAt: "desc" } }),
  ]);

  return NextResponse.json({
    ...redactWatcherStatus(watcherStatus(), user.role === "admin"),
    bookCount,
    lastScannedAt: lastBook?.scannedAt ?? null,
  });
});
