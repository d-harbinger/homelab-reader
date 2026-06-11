import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { parseJson, withUser, type IdContext } from "@/lib/route-helpers";

// PATCH /api/notes/[id] — update the note body.
// Body: { body }
export const PATCH = withUser<IdContext>(async (user, req, { params }) => {
  const { id } = await params;
  const parsed = await parseJson<{ body?: string }>(req);
  if (!parsed.ok) return parsed.res;
  if (typeof parsed.body.body !== "string") {
    return NextResponse.json({ error: "missing body" }, { status: 400 });
  }

  const existing = await prisma.note.findUnique({ where: { id } });
  if (!existing || existing.userId !== user.id) {
    return new NextResponse(null, { status: 404 });
  }

  const row = await prisma.note.update({
    where: { id },
    data: { body: parsed.body.body.slice(0, 16000) },
  });
  return NextResponse.json({
    id: row.id,
    body: row.body,
    updatedAt: row.updatedAt,
  });
});

// DELETE /api/notes/[id]
export const DELETE = withUser<IdContext>(async (user, _req, { params }) => {
  const { id } = await params;
  const existing = await prisma.note.findUnique({ where: { id } });
  if (!existing || existing.userId !== user.id) {
    return new NextResponse(null, { status: 404 });
  }
  await prisma.note.delete({ where: { id } });
  return new NextResponse(null, { status: 204 });
});
