import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { parseJson, withAdmin, type IdContext } from "@/lib/route-helpers";
import { deleteUser, setPassword, UserInputError } from "@/lib/users";

// PATCH /api/users/[id] — reset password and/or change role (admin only).
// Body: { password?: string, role?: "admin" | "reader" }
export const PATCH = withAdmin<IdContext>(async (_admin, req, { params }) => {
  const { id } = await params;

  const target = await prisma.user.findUnique({ where: { id } });
  if (!target) return new NextResponse(null, { status: 404 });

  const parsed = await parseJson<{ password?: string; role?: string }>(req);
  if (!parsed.ok) return parsed.res;
  const body = parsed.body;

  // Don't allow removing the last admin's admin role — that would lock
  // user management out entirely.
  if (body.role === "reader" && target.role === "admin") {
    const admins = await prisma.user.count({ where: { role: "admin" } });
    if (admins <= 1) {
      return NextResponse.json(
        { error: "Can't demote the only admin." },
        { status: 400 },
      );
    }
  }

  try {
    if (typeof body.password === "string" && body.password.length > 0) {
      await setPassword(id, body.password);
    }
    if (body.role === "admin" || body.role === "reader") {
      await prisma.user.update({ where: { id }, data: { role: body.role } });
    }
  } catch (e) {
    if (e instanceof UserInputError) {
      return NextResponse.json({ error: e.message }, { status: 400 });
    }
    throw e;
  }

  const updated = await prisma.user.findUnique({ where: { id } });
  return NextResponse.json({
    user: updated && {
      id: updated.id,
      username: updated.username,
      role: updated.role,
      createdAt: updated.createdAt,
    },
  });
});

// DELETE /api/users/[id] — remove an account (admin only). Guards against
// self-deletion and removing the last admin.
export const DELETE = withAdmin<IdContext>(async (me, _req, { params }) => {
  const { id } = await params;

  if (id === me.id) {
    return NextResponse.json(
      { error: "You can't delete your own account." },
      { status: 400 },
    );
  }

  const target = await prisma.user.findUnique({ where: { id } });
  if (!target) return new NextResponse(null, { status: 404 });

  if (target.role === "admin") {
    const admins = await prisma.user.count({ where: { role: "admin" } });
    if (admins <= 1) {
      return NextResponse.json(
        { error: "Can't delete the only admin." },
        { status: 400 },
      );
    }
  }

  await deleteUser(id);
  return new NextResponse(null, { status: 204 });
});
