import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withUser, type IdContext } from "@/lib/route-helpers";

// DELETE /api/ink/[id] — remove one of the caller's ink strokes.
// A non-existent id and another user's id both collapse to 404 so existence is
// never leaked across users (same posture as the highlights/notes by-id routes).
export const DELETE = withUser<IdContext>(async (user, _req, { params }) => {
  const { id } = await params;
  const existing = await prisma.inkStroke.findUnique({ where: { id } });
  if (!existing || existing.userId !== user.id) {
    return new NextResponse(null, { status: 404 });
  }
  await prisma.inkStroke.delete({ where: { id } });
  return new NextResponse(null, { status: 204 });
});
