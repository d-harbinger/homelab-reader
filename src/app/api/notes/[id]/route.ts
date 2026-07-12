import { withUser, type IdContext } from "@/lib/route-helpers";
import { patchNote, deleteNote } from "@/lib/annotations/notes";

// PATCH /api/notes/[id] — update the note body (cookie session).
// Body: { body }
export const PATCH = withUser<IdContext>(async (user, req, { params }) => {
  const { id } = await params;
  return patchNote(user.id, id, req);
});

// DELETE /api/notes/[id]
export const DELETE = withUser<IdContext>(async (user, _req, { params }) => {
  const { id } = await params;
  return deleteNote(user.id, id);
});
