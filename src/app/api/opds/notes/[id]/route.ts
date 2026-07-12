import { authenticateOpds, opdsChallenge } from "@/lib/opds-auth";
import { patchNote, deleteNote } from "@/lib/annotations/notes";

// OPDS-context note by-id routes (S2). Token-authed twin of /api/notes/[id].
// The context type is declared inline (rather than imported from route-helpers)
// so this module never transitively pulls in next-auth — same discipline the
// /api/opds/progress path follows.
type IdContext = { params: Promise<{ id: string }> };

// PATCH /api/opds/notes/[id] — update the note body.
// Body: { body }
export async function PATCH(req: Request, { params }: IdContext) {
  const user = await authenticateOpds(req);
  if (!user) return opdsChallenge();
  const { id } = await params;
  return patchNote(user.id, id, req);
}

// DELETE /api/opds/notes/[id] — remove a note.
export async function DELETE(req: Request, { params }: IdContext) {
  const user = await authenticateOpds(req);
  if (!user) return opdsChallenge();
  const { id } = await params;
  return deleteNote(user.id, id);
}
