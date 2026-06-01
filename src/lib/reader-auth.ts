import { getCurrentUser } from "@/lib/current-user";
import { authenticateOpds } from "@/lib/opds-auth";

// Auth guard for binary-content routes served to BOTH audiences: the book-file
// route (GET /api/books/[id]/file) and the cover route (GET /api/covers/[id]).
// The OPDS acquisition feed links to both, so they are fetched by the browser
// reader (NextAuth cookie session) AND by OPDS machine clients (per-user
// Basic/Bearer token). These paths are exempt from the cookie-only middleware
// gate (src/auth.config.ts) exactly like /api/opds, so they MUST authenticate
// in-route — otherwise a token-only mobile client is bounced to /login before
// it can download, and the exemption would leave the routes wide open.
//
// This composition lives in its own module (not in opds-auth.ts) on purpose:
// it pulls in getCurrentUser -> @/auth -> next-auth, and opds-auth.ts must stay
// a pure, next-auth-free token module so it (and its tests) load at the edge
// and under the test runner without dragging the full auth stack in.
//
// Accepts EITHER a valid cookie session OR a valid OPDS token; returns the
// resolved user, or null when neither credential is valid. Callers answer null
// with opdsChallenge() (from opds-auth.ts) so standard OPDS clients see the
// 401 + WWW-Authenticate prompt while browser fetches simply observe a 401.
export async function authenticateReaderRequest(
  req: Request,
): Promise<{ id: string; role: string } | null> {
  // Browser path first: the NextAuth session cookie. Machine clients carry no
  // cookie, so this returns null for them.
  const session = await getCurrentUser();
  if (session) return { id: session.id, role: session.role };

  // OPDS path: per-user Basic/Bearer token. extractToken short-circuits to
  // null without any DB query when there is no Authorization header, so an
  // entirely unauthenticated request costs one session decode and nothing more.
  const opds = await authenticateOpds(req);
  if (opds) return { id: opds.id, role: opds.role };

  return null;
}
