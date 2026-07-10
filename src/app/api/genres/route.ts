import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withAdmin } from "@/lib/route-helpers";
import { genreCounts } from "@/lib/library/genre-sections";

// GET /api/genres — every derived genre (top-level library folder) with its
// book count, merged with any stored display prefs. Admin-only: this is the
// manage-genres list. Unlike /api/genres/sections it applies no minBooks
// threshold, so even small genres can be renamed / reordered / hidden.
export const GET = withAdmin(async () => {
  const [books, locations, prefRows] = await Promise.all([
    prisma.book.findMany({ select: { filePath: true } }),
    prisma.scanLocation.findMany({ where: { enabled: true }, select: { path: true } }),
    prisma.genrePref.findMany(),
  ]);
  const counts = genreCounts(books, locations.map((l) => l.path));
  const prefs = new Map(prefRows.map((p) => [p.key, p]));
  const genres = [...counts.entries()]
    .map(([key, count]) => {
      const p = prefs.get(key);
      return {
        key,
        count,
        displayName: p?.displayName ?? null,
        hidden: p?.hidden ?? false,
        order: p?.order ?? null,
      };
    })
    // Ordered genres first (by stored order); the rest alphabetical.
    .sort((a, b) => {
      const oa = a.order ?? Number.MAX_SAFE_INTEGER;
      const ob = b.order ?? Number.MAX_SAFE_INTEGER;
      if (oa !== ob) return oa - ob;
      return a.key.localeCompare(b.key);
    });
  return NextResponse.json({ genres });
});

// PUT /api/genres — save the manage-genres form. Body: { genres: [{ key,
// displayName, hidden }] } in the DESIRED display order. Upserts one GenrePref
// per row with order = its index, so the submitted order becomes the stored
// order. Admin-only. Genres omitted from the body keep their existing prefs.
export const PUT = withAdmin(async (_admin, req) => {
  const body = await req.json().catch(() => null);
  const list = body?.genres;
  if (!Array.isArray(list)) {
    return NextResponse.json({ error: "Expected { genres: [...] }" }, { status: 400 });
  }
  const rows = list
    .filter((g) => g && typeof g.key === "string" && g.key.length > 0)
    .map((g, i) => ({
      key: g.key as string,
      displayName:
        typeof g.displayName === "string" && g.displayName.trim().length > 0
          ? g.displayName.trim()
          : null,
      hidden: Boolean(g.hidden),
      order: i,
    }));
  await prisma.$transaction(
    rows.map((r) =>
      prisma.genrePref.upsert({
        where: { key: r.key },
        create: r,
        update: { displayName: r.displayName, hidden: r.hidden, order: r.order },
      }),
    ),
  );
  return NextResponse.json({ ok: true, saved: rows.length });
});
