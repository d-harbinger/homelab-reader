import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withUser } from "@/lib/route-helpers";

// GET /api/books/facets — the filter vocabulary for the search page:
// every tag with a book count, plus per-format counts. Lets the browse
// UI show only filters that actually match something.
// Session-gated: the catalogue is not public. The gate is the shared
// wrapper rather than the middleware alone, so the route defends itself even
// if a matcher exemption ever grows to cover it.
export const GET = withUser(async () => {
  const [tags, formatGroups] = await Promise.all([
    prisma.tag.findMany({
      include: { _count: { select: { books: true } } },
    }),
    prisma.book.groupBy({
      by: ["format"],
      _count: { _all: true },
    }),
  ]);

  const tagFacets = tags
    .map((t) => ({ name: t.name, count: t._count.books }))
    .filter((t) => t.count > 0)
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

  const formatFacets = formatGroups
    .map((g) => ({ format: g.format, count: g._count._all }))
    .sort((a, b) => b.count - a.count);

  return NextResponse.json({ tags: tagFacets, formats: formatFacets });
});
