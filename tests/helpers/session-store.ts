// The fake session, held where both halves of the auth seam can see it.
//
// There are two seams now, not one. `auth()` says who the caller CLAIMS to be;
// the User row says whether that account still exists and what it is allowed to
// do — the gate re-reads it on every call (src/lib/current-user.ts) so that a
// demotion or a deletion takes effect immediately rather than whenever the
// token happens to expire.
//
// Suites that run against a real ephemeral database give the claim a real row
// with seedSessionUser() (tests/helpers/test-db.ts). Suites that have no
// database — the pure gate suites — instead mock "@/lib/prisma" with
// ./helpers/prisma-user-mock, which answers the row lookup out of this store.
// Either way the SAME session drives both seams, so a test cannot accidentally
// authenticate as one user and be read back as another.

export interface FakeSessionUser {
  id: string;
  role: "admin" | "reader";
}

let current: FakeSessionUser | null = null;

export function setStoredSession(user: FakeSessionUser | null): void {
  current = user;
}

export function storedSession(): FakeSessionUser | null {
  return current;
}
