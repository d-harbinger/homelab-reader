import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withUser } from "@/lib/route-helpers";

// GET /api/books/highlight-colors — for the signed-in reader, every book that
// carries highlights mapped to the colors on it and how many of each. Drives
// the library's "filter by highlight color" bar, so a reader can pull up every
// book holding, say, their green "key term" marks at a glance. Per-user by
// design: one reader's color scheme is not another's.
export const GET = withUser(async (user) => {
  const groups = await prisma.highlight.groupBy({
    by: ["bookId", "color"],
    where: { userId: user.id },
    _count: { _all: true },
  });

  const byBook: Record<string, Record<string, number>> = {};
  for (const g of groups) {
    (byBook[g.bookId] ??= {})[g.color] = g._count._all;
  }

  return NextResponse.json({ byBook });
});
