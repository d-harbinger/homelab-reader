import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getDefaultUserId } from "@/lib/default-user";

// PATCH /api/notes/[id] — update the note body.
// Body: { body }
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  let body: { body?: string };
  try {
    body = (await req.json()) as { body?: string };
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  if (typeof body.body !== "string") {
    return NextResponse.json({ error: "missing body" }, { status: 400 });
  }

  const userId = await getDefaultUserId();
  const existing = await prisma.note.findUnique({ where: { id } });
  if (!existing || existing.userId !== userId) {
    return new NextResponse(null, { status: 404 });
  }

  const row = await prisma.note.update({
    where: { id },
    data: { body: body.body.slice(0, 16000) },
  });
  return NextResponse.json({
    id: row.id,
    body: row.body,
    updatedAt: row.updatedAt,
  });
}

// DELETE /api/notes/[id]
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const userId = await getDefaultUserId();
  const existing = await prisma.note.findUnique({ where: { id } });
  if (!existing || existing.userId !== userId) {
    return new NextResponse(null, { status: 404 });
  }
  await prisma.note.delete({ where: { id } });
  return new NextResponse(null, { status: 204 });
}
