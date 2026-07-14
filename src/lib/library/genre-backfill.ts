// Backfill shelves for books imported before the genre normalizer
// existed (or that gained subjects later via enrichment). The raw
// subject strings already live as the book's tags — the scanner and
// the suggestion-accept path both attach them — so classification
// needs no re-extraction: read the tag names, run the taxonomy,
// fill NULL genres only. Owner-set shelves are never touched, which
// makes this safe to run on every manual rescan.
import { prisma } from "@/lib/prisma";
import { classifyGenre } from "./genre-taxonomy";

export async function backfillGenres(): Promise<number> {
  const unshelved = await prisma.book.findMany({
    where: { genre: null },
    select: { id: true, tags: { select: { name: true } } },
  });

  let assigned = 0;
  for (const book of unshelved) {
    const genre = classifyGenre(book.tags.map((t) => t.name));
    if (!genre) continue;
    await prisma.book.update({ where: { id: book.id }, data: { genre } });
    assigned += 1;
  }
  return assigned;
}
