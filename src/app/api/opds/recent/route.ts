import { prisma } from "@/lib/prisma";
import {
  bookEntryXml,
  feedXml,
  OPDS_ACQ,
  type OpdsBookEntry,
} from "@/lib/opds";

// GET /api/opds/recent — last 50 books added, newest first.
export async function GET() {
  const books = await prisma.book.findMany({
    include: { authors: true },
    orderBy: { addedAt: "desc" },
    take: 50,
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
    id: "tag:homelab-reader:recent",
    title: "Recently Added",
    selfHref: "/api/opds/recent",
    entries,
  });

  return new Response(xml, {
    headers: { "Content-Type": OPDS_ACQ },
  });
}
