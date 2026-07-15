import { authenticateOpds, opdsChallenge } from "@/lib/opds-auth";
import { getColorKey, putColorKeyEntry } from "@/lib/annotations/color-key";

// OPDS-context highlight color-key routes (S1).
//
// The token-reachable twin of /api/highlight-key. These authenticate with the
// per-user OPDS token — NOT the cookie session — and attribute every entry to
// the token's owner, so a client (android-reader) reads and writes only its own
// account's color key. The middleware exempts /api/opds* from the cookie gate
// BY DESIGN, so each handler MUST self-guard with authenticateOpds — the same
// shape /api/opds/highlights uses. The validation and response shapes are the
// shared annotations lib, identical to the session route.

// GET /api/opds/highlight-key?bookId=... — the token owner's color key for a
// book, as a color→label map (only labeled colors appear).
export async function GET(req: Request) {
  const user = await authenticateOpds(req);
  if (!user) return opdsChallenge();
  return getColorKey(user.id, req);
}

// PUT /api/opds/highlight-key — set one color's label for a book.
// Body: { bookId, color, label } — an empty label clears the entry.
export async function PUT(req: Request) {
  const user = await authenticateOpds(req);
  if (!user) return opdsChallenge();
  return putColorKeyEntry(user.id, req);
}
