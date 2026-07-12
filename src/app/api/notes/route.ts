import { withUser } from "@/lib/route-helpers";
import { createNote, listNotes } from "@/lib/annotations/notes";

// POST /api/notes — create a note attached to a CFI/page anchor (cookie session).
// Body: { bookId, anchor, body, context?, highlightId? }
// The validation + response shape live in the shared annotations lib, which the
// OPDS-token route (src/app/api/opds/notes) also calls.
export const POST = withUser((user, req) => createNote(user.id, req));

// GET /api/notes?bookId=... — list notes for a book.
export const GET = withUser((user, req) => listNotes(user.id, req));
