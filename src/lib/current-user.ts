import { NextResponse } from "next/server";
import { auth } from "@/auth";

export interface CurrentUser {
  id: string;
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
export async function getCurrentUser(): Promise<CurrentUser | null> {
  const session = await auth();
  const id = session?.user?.id;
  if (!id) return null;
  return { id, role: session.user.role ?? "reader" };
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
