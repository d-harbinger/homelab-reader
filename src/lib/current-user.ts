import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

export interface CurrentUser {
  id: string;
  username: string;
  role: string;
}

export class UnauthenticatedError extends Error {
  constructor() {
    super("unauthenticated");
    this.name = "UnauthenticatedError";
  }
}

export class ForbiddenError extends Error {
  constructor() {
    super("forbidden");
    this.name = "ForbiddenError";
  }
}

// The signed-in user, or null when there's no session. Use this when the
// caller wants to branch on auth state (e.g. show/hide admin UI).
//
// The row is RE-READ on every call rather than trusted from the token. The
// session is a JWT: `role` is stamped into it once, at sign-in, and nothing
// afterwards can reach back and change it. Without the re-read, demoting an
// admin to `reader` in the user-management screen would leave their existing
// cookie answering "admin" for the life of the token — long enough for them to
// promote themselves back and delete the account that demoted them — and
// deleting an account would not stop it browsing, downloading or streaming,
// because the id in the token still resolves.
//
// Taking someone's access away has to mean now. The cost is one point-read on
// the primary key per gated call, and the wrappers in route-helpers.ts call
// this exactly once per request, so nothing here needs a cache: a per-request
// memo would save zero queries and add a scope that could outlive the request
// it was meant to bound. (Ported from homelab-banking's
// src/lib/require-admin.ts, which documents the same reasoning.)
export async function getCurrentUser(): Promise<CurrentUser | null> {
  const session = await auth();
  const id = session?.user?.id;
  if (!id) return null;

  const row = await prisma.user.findUnique({
    where: { id },
    select: { id: true, username: true, role: true },
  });
  if (!row) return null;

  return { id: row.id, username: row.username, role: row.role ?? "reader" };
}

// Resolve the signed-in user's id for attributing notes / highlights /
// progress. Routes that call this sit behind the auth middleware, so a
// session is normally present; the throw is a defensive guard surfaced by
// callers as a 401.
export async function getCurrentUserId(): Promise<string> {
  const user = await getCurrentUser();
  if (!user) throw new UnauthenticatedError();
  return user.id;
}

// Require an admin session. Throws Unauthenticated (→401) when signed out,
// Forbidden (→403) when signed in without the admin role.
export async function requireAdmin(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) throw new UnauthenticatedError();
  if (user.role !== "admin") throw new ForbiddenError();
  return user;
}

// Map the typed auth errors to their HTTP responses: Unauthenticated → 401,
// Forbidden → 403, anything else re-thrown for the framework to handle. Routes
// call this from the catch around requireAdmin()/getCurrentUserId().
export function authError(e: unknown): NextResponse {
  if (e instanceof UnauthenticatedError) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  if (e instanceof ForbiddenError) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  throw e;
}
