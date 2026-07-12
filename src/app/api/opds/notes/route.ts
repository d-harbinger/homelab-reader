import { authenticateOpds, opdsChallenge } from "@/lib/opds-auth";
import { createNote, listNotes } from "@/lib/annotations/notes";

// OPDS-context note collection routes (S2).
//
// The token-reachable twin of /api/notes. These authenticate with the per-user
// OPDS token — NOT the cookie session — and attribute every row to the token's
// owner. The middleware exempts /api/opds* from the cookie gate BY DESIGN, so
// each handler MUST self-guard with authenticateOpds. Validation (including the
// optional highlightId ownership-404) and response shapes are the shared
// annotations lib, identical to the session route.

// POST /api/opds/notes — create a note attached to a CFI/page anchor.
// Body: { bookId, anchor, body, context?, highlightId? }
export async function POST(req: Request) {
  const user = await authenticateOpds(req);
  if (!user) return opdsChallenge();
  return createNote(user.id, req);
}

// GET /api/opds/notes?bookId=... — list the token owner's notes.
export async function GET(req: Request) {
  const user = await authenticateOpds(req);
  if (!user) return opdsChallenge();
  return listNotes(user.id, req);
}
