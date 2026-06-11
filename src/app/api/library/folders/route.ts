import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withUser } from "@/lib/route-helpers";
import { buildFolderTree } from "@/lib/library/folder-tree";

// GET /api/library/folders — the on-disk shelf tree derived from book paths.
//
// Session-gated: any signed-in reader may see the shelves; signed-out → 401.
//
// Privacy: buildFolderTree strips the scan root, so the response carries only
// relative folder names (e.g. "python/web") — the full filesystem paths, which
// on a homelab are home-directory paths, never reach the client.
export const GET = withUser(async () => {
  const [books, locations] = await Promise.all([
    prisma.book.findMany({ select: { filePath: true } }),
    prisma.scanLocation.findMany({
      where: { enabled: true },
      select: { path: true },
    }),
  ]);

  const tree = buildFolderTree(
    books,
    locations.map((l) => l.path),
  );
  return NextResponse.json({ tree });
});
