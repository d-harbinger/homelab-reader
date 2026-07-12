import { withUser, type IdContext } from "@/lib/route-helpers";
import { patchHighlight, deleteHighlight } from "@/lib/annotations/highlights";

// PATCH /api/highlights/[id] — change color (cookie session).
// Body: { color }
export const PATCH = withUser<IdContext>(async (user, req, { params }) => {
  const { id } = await params;
  return patchHighlight(user.id, id, req);
});

// DELETE /api/highlights/[id] — remove a highlight.
export const DELETE = withUser<IdContext>(async (user, _req, { params }) => {
  const { id } = await params;
  return deleteHighlight(user.id, id);
});
