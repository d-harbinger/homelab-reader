import { prisma } from "@/lib/prisma";
import { feedXml, navEntryXml, OPDS_NAV } from "@/lib/opds";

// GET /api/opds — root navigation catalog. OPDS-aware readers point here
// and discover the subsections (All Books, Recently Added).
export async function GET() {
  const bookCount = await prisma.book.count();

  const entries: string[] = [
    navEntryXml({
      id: "tag:homelab-reader:all",
      title: "All Books",
      href: "/api/opds/all",
      summary: `${bookCount} ${bookCount === 1 ? "book" : "books"}`,
      acquisition: true,
    }),
    navEntryXml({
      id: "tag:homelab-reader:recent",
      title: "Recently Added",
      href: "/api/opds/recent",
      summary: "Newest additions to the library",
      acquisition: true,
    }),
  ];

  const xml = feedXml({
    id: "tag:homelab-reader:root",
    title: "homelab-reader",
    selfHref: "/api/opds",
    entries,
  });

  return new Response(xml, {
    headers: { "Content-Type": OPDS_NAV },
  });
}
