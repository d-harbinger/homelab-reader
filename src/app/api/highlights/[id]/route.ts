import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authError, getCurrentUserId } from "@/lib/current-user";

const VALID_COLORS = new Set(["yellow", "green", "blue", "pink"]);

// PATCH /api/highlights/[id] — change color.
// Body: { color }
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  let body: { color?: string };
  try {
    body = (await req.json()) as { color?: string };
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  let userId: string;
  try {
    userId = await getCurrentUserId();
  } catch (e) {
    return authError(e);
  }
  const existing = await prisma.highlight.findUnique({ where: { id } });
  if (!existing || existing.userId !== userId) {
    return new NextResponse(null, { status: 404 });
  }

  const color =
    body.color && VALID_COLORS.has(body.color) ? body.color : existing.color;

  const row = await prisma.highlight.update({
    where: { id },
    data: { color },
  });
  return NextResponse.json({ id: row.id, color: row.color });
}

// DELETE /api/highlights/[id] — remove a highlight.
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
  const existing = await prisma.highlight.findUnique({ where: { id } });
  if (!existing || existing.userId !== userId) {
    return new NextResponse(null, { status: 404 });
  }
  await prisma.highlight.delete({ where: { id } });
  return new NextResponse(null, { status: 204 });
}
