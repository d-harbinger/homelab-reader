import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

// Directory part of `filePath` relative to the longest matching scan root
// (the filename dropped), e.g. "/books/python/web/b.epub" under root "/books"
// → "python/web". null if the file isn't under any root. This mirrors the
// longest-root logic in src/lib/library/folder-tree.ts so the folder filter
// and the folder tree agree on what folder a book lives in.
function relativeFolder(filePath: string, roots: string[]): string | null {
  const normalized = roots
    .map((r) => r.replace(/\/+$/, ""))
    .sort((a, b) => b.length - a.length); // longest (most specific) first

  for (const root of normalized) {
    const prefix = `${root}/`;
    if (filePath.startsWith(prefix)) {
      const segs = filePath.slice(prefix.length).split("/");
      segs.pop(); // drop the filename
      return segs.join("/");
    }
  }
  return null;
}

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
// The `folder` filter is computed server-side: each book's absolute filePath
// is stripped of its scan root and compared as a relative path. Absolute paths
// never enter the response — the comparison happens here, and the response map
// is unchanged.
//
// Note: SQLite's LIKE (what Prisma `contains` compiles to) is already
// case-insensitive for ASCII, so we don't pass `mode: "insensitive"` —
// that modifier is unsupported on SQLite and would throw.
export async function GET(req: Request) {
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

  // findMany returns all scalar fields (filePath included) plus the authors
  // relation. filePath is used only to compute the relative folder below; it
  // is never copied into the response map.
  const books = await prisma.book.findMany({
    where,
    orderBy: sort === "title" ? { title: "asc" } : { addedAt: "desc" },
    take: 200,
    include: { authors: true },
  });

  let filtered = books;
  if (folder) {
    const roots = (
      await prisma.scanLocation.findMany({
        where: { enabled: true },
        select: { path: true },
      })
    ).map((l) => l.path);
    const target = folder.replace(/^\/+|\/+$/g, "");
    filtered = books.filter((b) => {
      const rel = relativeFolder(b.filePath, roots);
      if (rel === null) return false;
      // A book matches when its folder is the target or nested below it.
      return rel === target || rel.startsWith(`${target}/`);
    });
  }

  return NextResponse.json({
    books: filtered.map((b) => ({
      id: b.id,
      title: b.title,
      format: b.format,
      authors: b.authors.map((a) => a.name),
      language: b.language ?? null,
      pageCount: b.pageCount ?? null,
      fileSizeBytes: b.fileSizeBytes ?? null,
      coverUrl: b.coverPath ? `/api/covers/${b.id}` : null,
      addedAt: b.addedAt,
    })),
  });
}
