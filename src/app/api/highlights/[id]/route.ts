import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { parseJson, withUser, type IdContext } from "@/lib/route-helpers";

const VALID_COLORS = new Set(["yellow", "green", "blue", "pink"]);

// PATCH /api/highlights/[id] — change color.
// Body: { color }
export const PATCH = withUser<IdContext>(async (user, req, { params }) => {
  const { id } = await params;
  const parsed = await parseJson<{ color?: string }>(req);
  if (!parsed.ok) return parsed.res;

  const existing = await prisma.highlight.findUnique({ where: { id } });
  if (!existing || existing.userId !== user.id) {
    return new NextResponse(null, { status: 404 });
  }

  const color =
    parsed.body.color && VALID_COLORS.has(parsed.body.color)
      ? parsed.body.color
      : existing.color;

  const row = await prisma.highlight.update({
    where: { id },
    data: { color },
  });
  return NextResponse.json({ id: row.id, color: row.color });
});

// DELETE /api/highlights/[id] — remove a highlight.
export const DELETE = withUser<IdContext>(async (user, _req, { params }) => {
  const { id } = await params;
  const existing = await prisma.highlight.findUnique({ where: { id } });
  if (!existing || existing.userId !== user.id) {
    return new NextResponse(null, { status: 404 });
  }
  await prisma.highlight.delete({ where: { id } });
  return new NextResponse(null, { status: 204 });
});
