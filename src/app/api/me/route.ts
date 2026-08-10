import { NextResponse } from "next/server";
import { withUser } from "@/lib/route-helpers";

// GET /api/me — the current session's identity, for client UI that needs to
// branch on role (e.g. showing the user-management link to admins only).
//
// The role comes from the live user row, not from the token claim: the whole
// point of this endpoint is that the client trusts it, so serving a role the
// administrator has already revoked would put the admin controls back on the
// screen of someone who no longer has them. withUser resolves that row (see
// src/lib/current-user.ts) and answers 401 when the account is gone.
export const GET = withUser(async (user) => {
  return NextResponse.json({
    user: { id: user.id, name: user.username, role: user.role },
  });
});
