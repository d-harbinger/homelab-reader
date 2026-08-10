import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { parseJson, withAdmin, withUser, type IdContext } from "@/lib/route-helpers";
import { UNSORTED } from "@/lib/library/genre-taxonomy";

// Session-gated like the rest of the catalogue. The PATCH below has always been
// admin-only; the GET was relying on the middleware alone, which made this file
// asymmetric about its own access rules.
export const GET = withUser<IdContext>(async (_user, _req, { params }) => {
  const { id } = await params;
  const book = await prisma.book.findUnique({
    where: { id },
    include: { authors: true, tags: true },
  });
  if (!book) return new NextResponse(null, { status: 404 });

  return NextResponse.json({
    id: book.id,
    title: book.title,
    subtitle: book.subtitle,
    format: book.format,
    authors: book.authors.map((a) => a.name),
    tags: book.tags.map((t) => t.name),
    genre: book.genre,
    language: book.language,
    publisher: book.publisher,
    publishedAt: book.publishedAt,
    description: book.description,
    isbn: book.isbn,
    pageCount: book.pageCount,
    fileSizeBytes: book.fileSizeBytes,
    coverUrl: book.coverPath ? `/api/covers/${book.id}` : null,
    addedAt: book.addedAt,
  });
});

// PATCH /api/books/[id] — curation writes, allowlisted to `genre` (the
// bookstore shelf). Admin-only like the other curation actions
// (suggestion accept, genre prefs): shelving is library-wide state.
// `null` (or the reserved "Unsorted" label) clears the shelf; any other
// non-empty string ≤ 64 chars is accepted, so custom shelves beyond the
// taxonomy are possible — /api/shelves/sections orders them after the
// taxonomy shelves.
type BookContext = { params: Promise<{ id: string }> };
interface GenrePayload {
  genre?: unknown;
}

export const PATCH = withAdmin<BookContext>(async (_admin, req, ctx) => {
  const { id } = await ctx.params;
  const parsed = await parseJson<GenrePayload>(req);
  if (!parsed.ok) return parsed.res;

  if (!("genre" in parsed.body)) {
    return NextResponse.json({ error: "genre is required" }, { status: 400 });
  }
  const raw = parsed.body.genre;
  let genre: string | null;
  if (raw === null) {
    genre = null;
  } else if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (trimmed.length > 64) {
      return NextResponse.json({ error: "genre too long (max 64)" }, { status: 400 });
    }
    genre = trimmed === "" || trimmed === UNSORTED ? null : trimmed;
  } else {
    return NextResponse.json({ error: "genre must be a string or null" }, { status: 400 });
  }

  const book = await prisma.book.findUnique({ where: { id }, select: { id: true } });
  if (!book) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await prisma.book.update({ where: { id }, data: { genre } });
  return NextResponse.json({ ok: true, genre });
});
