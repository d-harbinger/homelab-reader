import { NextResponse } from "next/server";
import { auth } from "@/auth";

// GET /api/me — the current session's identity, for client UI that needs to
// branch on role (e.g. showing the user-management link to admins only).
export async function GET() {
  const session = await auth();
  const user = session?.user;
  if (!user?.id) {
    return NextResponse.json({ user: null }, { status: 401 });
  }
  return NextResponse.json({
    user: { id: user.id, name: user.name ?? null, role: user.role ?? "reader" },
  });
}
