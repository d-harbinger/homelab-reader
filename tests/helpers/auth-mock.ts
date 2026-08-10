// Auth seam helpers for handler tests.
//
// The single auth boundary is `auth()` exported from "@/auth". Mocking it lets
// the real getCurrentUser / getCurrentUserId / requireAdmin logic in
// src/lib/current-user.ts run its true role/identity branching against a fake
// session — higher fidelity than faking a JWT.
//
// IMPORTANT (RESEARCH Pitfall 2): the vi.mock call must live in the TEST FILE
// at top level, not here. `vi.mock` is hoisted above all imports and its
// factory must be self-contained, so each spec declares:
//
//     vi.mock("@/auth", () => ({ auth: vi.fn() }));
//
// Then it imports these helpers to drive the mocked function. The helpers only
// read the already-mocked `auth` via vi.mocked(); they do not call vi.mock.

import { vi } from "vitest";
import { auth } from "@/auth";
import { setStoredSession } from "./session-store";

export type FakeRole = "admin" | "reader";

// getCurrentUser reads session?.user?.id, then RE-READS the User row
// (src/lib/current-user.ts). null = no session = signed out.
export interface FakeSession {
  user: { id: string; role: FakeRole };
}

// auth() is async, so use mockResolvedValue (NOT mockReturnValue).
//
// The session is also written to the shared store (./session-store) so the row
// half of the seam sees the same caller. A suite with no database picks the row
// up by mocking "@/lib/prisma" with ./prisma-user-mock; a suite with a real
// ephemeral database instead gives the id a real row via seedSessionUser().
// Setting a session does NOT by itself create an account — that is the point of
// the gate, and a suite that forgets gets a 401 rather than a false pass.
export function setSession(session: FakeSession | null): void {
  vi.mocked(auth).mockResolvedValue(session as never);
  setStoredSession(session ? { ...session.user } : null);
}

export function signOut(): void {
  setSession(null);
}

export function asReader(id: string): void {
  setSession({ user: { id, role: "reader" } });
}

export function asAdmin(id: string): void {
  setSession({ user: { id, role: "admin" } });
}
