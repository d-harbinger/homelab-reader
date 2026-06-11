import { NextResponse } from "next/server";
import { parseJson, withAdmin } from "@/lib/route-helpers";
import { createUser, listUsers, UserInputError, type Role } from "@/lib/users";

// GET /api/users — list accounts (admin only).
export const GET = withAdmin(async () => {
  return NextResponse.json({ users: await listUsers() });
});

// POST /api/users — create an account (admin only).
// Body: { username, password, role?: "admin" | "reader" }
export const POST = withAdmin(async (_admin, req) => {
  const parsed = await parseJson<{
    username?: string;
    password?: string;
    role?: string;
  }>(req);
  if (!parsed.ok) return parsed.res;

  const role: Role = parsed.body.role === "admin" ? "admin" : "reader";
  try {
    const user = await createUser({
      username: String(parsed.body.username ?? ""),
      password: String(parsed.body.password ?? ""),
      role,
    });
    return NextResponse.json({ user }, { status: 201 });
  } catch (e) {
    if (e instanceof UserInputError) {
      return NextResponse.json({ error: e.message }, { status: 400 });
    }
    throw e;
  }
});
