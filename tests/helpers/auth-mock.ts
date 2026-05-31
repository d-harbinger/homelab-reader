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

export type FakeRole = "admin" | "reader";

// getCurrentUser reads session?.user?.id and session.user.role
// (src/lib/current-user.ts). null = no session = signed out.
export interface FakeSession {
  user: { id: string; role: FakeRole };
}

// auth() is async, so use mockResolvedValue (NOT mockReturnValue).
export function setSession(session: FakeSession | null): void {
  vi.mocked(auth).mockResolvedValue(session as never);
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
