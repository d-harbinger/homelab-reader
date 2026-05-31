import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authError, getCurrentUserId } from "@/lib/current-user";

// DELETE /api/opds-tokens/[id] — revoke one of the caller's own tokens.
//
// Ownership is enforced exactly like src/app/api/notes/[id]/route.ts: a token
// that is not the caller's returns 404 (not 403), so the existence of another
// user's token id is never leaked. Next 15 hands `params` as a Promise.
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  let userId: string;
  try {
    userId = await getCurrentUserId();
  } catch (e) {
    return authError(e);
  }

  const existing = await prisma.opdsToken.findUnique({ where: { id } });
  if (!existing || existing.userId !== userId) {
    return new NextResponse(null, { status: 404 });
  }

  await prisma.opdsToken.delete({ where: { id } });
  return new NextResponse(null, { status: 204 });
}
