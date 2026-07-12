import { withUser } from "@/lib/route-helpers";
import { createHighlight, listHighlights } from "@/lib/annotations/highlights";

// POST /api/highlights — create a highlight on a book (cookie session).
// The validation + response shape live in the shared annotations lib, which the
// OPDS-token route (src/app/api/opds/highlights) also calls; this route is just
// the cookie-session front door onto it.
export const POST = withUser((user, req) => createHighlight(user.id, req));

// GET /api/highlights?bookId=... — list highlights for a book.
export const GET = withUser((user, req) => listHighlights(user.id, req));
