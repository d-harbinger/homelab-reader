import { prisma } from "@/lib/prisma";
import {
  bookEntryXml,
  feedXml,
  OPDS_ACQ,
  type OpdsBookEntry,
} from "@/lib/opds";
import { authenticateOpds, opdsChallenge } from "@/lib/opds-auth";

// GET /api/opds/all — full library as an OPDS acquisition feed.
// Pagination is a later phase; KOReader handles long feeds gracefully.
//
// In-route auth (see /api/opds): no valid per-user token -> 401 challenge.
export async function GET(req: Request) {
  const user = await authenticateOpds(req);
  if (!user) return opdsChallenge();

  const books = await prisma.book.findMany({
    include: { authors: true },
    orderBy: { addedAt: "desc" },
  });

  const entries = books.map((b) => {
    const entry: OpdsBookEntry = {
      id: b.id,
      title: b.title,
      authors: b.authors.map((a) => a.name),
      language: b.language,
      description: b.description,
      publishedAt: b.publishedAt,
      updatedAt: b.scannedAt,
      format: b.format as "epub" | "pdf",
      coverPath: b.coverPath,
    };
    return bookEntryXml(entry);
  });

  const xml = feedXml({
    id: "tag:homelab-reader:all",
    title: "All Books",
    selfHref: "/api/opds/all",
    entries,
  });

  return new Response(xml, {
    headers: { "Content-Type": OPDS_ACQ },
  });
}
