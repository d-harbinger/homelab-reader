import { prisma } from "@/lib/prisma";
import { feedXml, navEntryXml, OPDS_NAV } from "@/lib/opds";
import { authenticateOpds, opdsChallenge } from "@/lib/opds-auth";

// GET /api/opds — root navigation catalog. OPDS-aware readers point here
// and discover the subsections (All Books, Recently Added).
//
// Auth is enforced in-route (OPDS is middleware-exempt): authenticateOpds
// accepts a per-user HTTP Basic/Bearer token; no valid token -> 401 challenge.
// The catalog is the same for every authenticated user in v1 (global-per-user
// token scope per docs/OPDS-AUTH-CONTRACT.md); the guard gates access only.
export async function GET(req: Request) {
  const user = await authenticateOpds(req);
  if (!user) return opdsChallenge();

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
