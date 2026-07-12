import { authenticateOpds, opdsChallenge } from "@/lib/opds-auth";
import { createHighlight, listHighlights } from "@/lib/annotations/highlights";

// OPDS-context highlight collection routes (S2).
//
// The token-reachable twin of /api/highlights. These authenticate with the
// per-user OPDS token — NOT the cookie session — and attribute every row to the
// token's owner, so a client (android-reader) reads and writes only its own
// account's highlights. The middleware exempts /api/opds* from the cookie gate
// BY DESIGN, so each handler MUST self-guard with authenticateOpds — the same
// shape POST /api/opds/progress uses. The validation and response shapes are the
// shared annotations lib, identical to the session route.

// POST /api/opds/highlights — create a highlight on a book.
export async function POST(req: Request) {
  const user = await authenticateOpds(req);
  if (!user) return opdsChallenge();
  return createHighlight(user.id, req);
}

// GET /api/opds/highlights?bookId=... — list the token owner's highlights.
export async function GET(req: Request) {
  const user = await authenticateOpds(req);
  if (!user) return opdsChallenge();
  return listHighlights(user.id, req);
}
