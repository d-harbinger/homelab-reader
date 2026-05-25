import { NextResponse } from "next/server";
import {
  ForbiddenError,
  requireAdmin,
  UnauthenticatedError,
} from "@/lib/current-user";
import { createUser, listUsers, UserInputError, type Role } from "@/lib/users";

// GET /api/users — list accounts (admin only).
export async function GET() {
  try {
    await requireAdmin();
  } catch (e) {
    return authError(e);
  }
  return NextResponse.json({ users: await listUsers() });
}

// POST /api/users — create an account (admin only).
// Body: { username, password, role?: "admin" | "reader" }
export async function POST(req: Request) {
  try {
    await requireAdmin();
  } catch (e) {
    return authError(e);
  }

  let body: { username?: string; password?: string; role?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const role: Role = body.role === "admin" ? "admin" : "reader";
  try {
    const user = await createUser({
      username: String(body.username ?? ""),
      password: String(body.password ?? ""),
      role,
    });
    return NextResponse.json({ user }, { status: 201 });
  } catch (e) {
    if (e instanceof UserInputError) {
      return NextResponse.json({ error: e.message }, { status: 400 });
    }
    throw e;
  }
}

export function authError(e: unknown): NextResponse {
  if (e instanceof UnauthenticatedError) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  if (e instanceof ForbiddenError) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  throw e;
}
