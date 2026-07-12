import { authenticateOpds, opdsChallenge } from "@/lib/opds-auth";
import { patchHighlight, deleteHighlight } from "@/lib/annotations/highlights";

// OPDS-context highlight by-id routes (S2). Token-authed twin of
// /api/highlights/[id]. The context type is declared inline (rather than
// imported from route-helpers) so this module never transitively pulls in
// next-auth — same discipline the /api/opds/progress path follows.
type IdContext = { params: Promise<{ id: string }> };

// PATCH /api/opds/highlights/[id] — change color.
// Body: { color }
export async function PATCH(req: Request, { params }: IdContext) {
  const user = await authenticateOpds(req);
  if (!user) return opdsChallenge();
  const { id } = await params;
  return patchHighlight(user.id, id, req);
}

// DELETE /api/opds/highlights/[id] — remove a highlight.
export async function DELETE(req: Request, { params }: IdContext) {
  const user = await authenticateOpds(req);
  if (!user) return opdsChallenge();
  const { id } = await params;
  return deleteHighlight(user.id, id);
}
