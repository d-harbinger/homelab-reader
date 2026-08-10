import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { relativeFolder } from "@/lib/library/folder-tree";
import { withUser } from "@/lib/route-helpers";

// GET /api/books — flat list, newest first by default.
//
// Optional query params turn this into the search/browse backend:
//   q       free-text match on title, subtitle, or author name
//   format  "epub" | "pdf"
//   tag      exact tag name
//   sort     "recent" (default) | "title"
//   folder   root-relative folder path (e.g. "python/web") — filters to books
//            whose folder is, or sits under, that path
//
// With no params the response is identical to the original flat list, so
// the home view keeps working unchanged.
//
// The `folder` filter is pushed into the SQL `where` as a set of absolute
// path-prefix matches — one per enabled scan root — so the row cap below
// applies to the FILTERED result, not to a recent-first window that the match
// is then applied to in memory. (The old in-memory filter ran after `take: 200`
// and so was blind to any matching book older than the 200 newest overall:
// libraries past 200 books lost their oldest folder hits entirely.)
//
// Each clause is `filePath startsWith "<root>/<target>/"`. The trailing slash
// is load-bearing on both ends: a file directly in the folder still matches
// because its own filename adds the final segment (`<root>/<target>/<file>`),
// while a sibling folder sharing a name prefix cannot — `python/webinar/...`
// does not start with `<root>/python/web/`. Absolute paths never enter the
// response; only the comparison touches them, and the response map is unchanged.
//
// Note: SQLite's LIKE (what Prisma `contains` compiles to) is already
// case-insensitive for ASCII, so we don't pass `mode: "insensitive"` —
// that modifier is unsupported on SQLite and would throw.
// Session-gated: the catalogue is not public. The gate is the shared
// wrapper rather than the middleware alone, so the route defends itself even
// if a matcher exemption ever grows to cover it.
export const GET = withUser(async (_user, req) => {
  const url = new URL(req.url);
  const q = url.searchParams.get("q")?.trim() ?? "";
  const format = url.searchParams.get("format")?.trim() ?? "";
  const tag = url.searchParams.get("tag")?.trim() ?? "";
  const folder = url.searchParams.get("folder")?.trim() ?? "";
  const sort = url.searchParams.get("sort") === "title" ? "title" : "recent";

  const where: Prisma.BookWhereInput = {};
  if (q) {
    where.OR = [
      { title: { contains: q } },
      { subtitle: { contains: q } },
      { authors: { some: { name: { contains: q } } } },
    ];
  }
  if (format === "epub" || format === "pdf") where.format = format;
  if (tag) where.tags = { some: { name: tag } };

  // Enabled scan roots, normalized (trailing slashes stripped). Fetched
  // unconditionally — the `folder` filter below needs them, and so does the
  // server-side genre derivation in the response map. They never enter the
  // response; only the comparison and the genre-name derivation touch them.
  const roots = (
    await prisma.scanLocation.findMany({
      where: { enabled: true },
      select: { path: true },
    })
  ).map((l) => l.path.replace(/\/+$/, ""));

  if (folder) {
    // Match in SQL against each enabled scan root: a book is "in" the folder
    // when its absolute path begins with "<root>/<target>/". Normalize the
    // target (strip leading/trailing slashes) so the joined prefix has exactly
    // one slash at each seam.
    // No enabled roots → nothing can match. Skip the query entirely.
    if (roots.length === 0) {
      return NextResponse.json({ books: [] });
    }
    const target = folder.replace(/^\/+|\/+$/g, "");
    // AND-combine with any existing OR (free-text `q`): wrapping the root
    // prefixes in their own AND clause keeps the two OR groups independent.
    where.AND = [
      { OR: roots.map((r) => ({ filePath: { startsWith: `${r}/${target}/` } })) },
    ];
  }

  // findMany returns all scalar fields (filePath included) plus the authors
  // relation. filePath is never copied into the response map.
  const books = await prisma.book.findMany({
    where,
    orderBy: sort === "title" ? { title: "asc" } : { addedAt: "desc" },
    take: 200,
    include: { authors: true },
  });

  return NextResponse.json({
    books: books.map((b) => {
      // Top-level genre = the first segment of the book's root-relative folder.
      // relativeFolder returns "" for a file sitting directly under a root and
      // null when the file is under no root; both mean "no genre". filePath is
      // read ONLY here to derive the name and is never copied into the response.
      const rel = relativeFolder(b.filePath, roots);
      const genre = rel ? rel.split("/")[0] : null;
      return {
        id: b.id,
        title: b.title,
        format: b.format,
        authors: b.authors.map((a) => a.name),
        language: b.language ?? null,
        pageCount: b.pageCount ?? null,
        fileSizeBytes: b.fileSizeBytes ?? null,
        coverUrl: b.coverPath ? `/api/covers/${b.id}` : null,
        addedAt: b.addedAt,
        genre,
      };
    }),
  });
});
