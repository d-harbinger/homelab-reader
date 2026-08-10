import { NextResponse } from "next/server";
import { createHash, timingSafeEqual } from "node:crypto";
import { prisma } from "@/lib/prisma";

// The identity an OPDS request resolves to. Deliberately narrow — the guard
// never hands `passwordHash` (or any other User column) to feed handlers.
export type OpdsUser = { id: string; username: string; role: string };

// OPDS authentication guard.
//
// OPDS clients (android-reader and standard readers) are machine clients, not
// browsers, so they do NOT carry the NextAuth cookie session. Instead each user
// mints a per-user API token (an "app password") and the client sends it on
// every OPDS request. The wire contract both repos agreed on lives in
// docs/OPDS-AUTH-CONTRACT.md and is non-negotiable here — android-reader is
// built against it in a separate repo.
//
// Transport: the client sends HTTP Basic — Authorization: Basic
// base64(username ":" token). The server MUST also accept Bearer <token>.
// Tokens are stored hashed at rest (SHA-256 hex); the plaintext is never
// persisted and never logged. The token never appears in this module's output.

// The exact challenge the contract pins. Standard OPDS clients read this realm
// and prompt the user for credentials.
const OPDS_REALM = 'Basic realm="homelab-reader OPDS"';

// How long a freshly minted token works for.
//
// These are app passwords living on a phone. Revocation already exists, but
// revocation only helps the person who remembers to use it, and the usual fate
// of a token on a lost or replaced handset is to be forgotten rather than
// revoked. An expiry is the half of the lifecycle that does not depend on
// anyone noticing.
//
// Ninety days is the compromise: long enough that re-pairing a reader is a
// quarterly chore rather than a weekly one, short enough that a token on a
// handset that left the house last spring is already dead.
export const TOKEN_LIFETIME_DAYS = 90;

/** The expiry stamp for a token minted now (or at `from`). */
export function tokenExpiry(from: Date = new Date()): Date {
  return new Date(from.getTime() + TOKEN_LIFETIME_DAYS * 24 * 60 * 60 * 1000);
}

// Pull the opaque token out of the Authorization header, or null when the
// header is absent or uses a scheme that is neither Basic nor Bearer.
//
// The scheme prefixes are matched case-sensitively exactly as the contract
// writes them ("Basic ", "Bearer "). For Basic we base64-decode the credential
// and split on the FIRST colon only: the username is the left half, the token
// is EVERYTHING after the first colon, so a token that itself contains a colon
// survives intact.
function extractToken(req: Request): string | null {
  const header = req.headers.get("authorization");
  if (!header) return null;

  if (header.startsWith("Basic ")) {
    const b64 = header.slice("Basic ".length).trim();
    let decoded: string;
    try {
      decoded = Buffer.from(b64, "base64").toString("utf8");
    } catch {
      return null;
    }
    const colon = decoded.indexOf(":");
    if (colon === -1) return null;
    const token = decoded.slice(colon + 1);
    return token.length > 0 ? token : null;
  }

  if (header.startsWith("Bearer ")) {
    const token = header.slice("Bearer ".length).trim();
    return token.length > 0 ? token : null;
  }

  return null;
}

// Authenticate an OPDS request. Returns the owning User on a valid token, or
// null when the header is missing, malformed, or the token is unknown/wrong.
// The caller turns null into a 401 challenge via opdsChallenge().
//
// On success it fires a fire-and-forget lastUsedAt bump that the caller MUST
// NOT await — the feed should not wait on a bookkeeping write.
export async function authenticateOpds(req: Request): Promise<OpdsUser | null> {
  const token = extractToken(req);
  if (!token) return null;

  // High-entropy opaque secret, so a fast cryptographic hash is correct here
  // (bcrypt is for low-entropy passwords). Look the row up by the hash.
  const tokenHash = createHash("sha256").update(token).digest("hex");

  const row = await prisma.opdsToken.findUnique({
    where: { tokenHash },
    select: {
      id: true,
      tokenHash: true,
      expiresAt: true,
      user: { select: { id: true, username: true, role: true } },
    },
  });
  if (!row) return null;

  // Expired is indistinguishable from unknown on the wire — the caller turns
  // both into the same 401 challenge. A client that learns "this token was
  // real, just old" learns something a stranger holding it should not.
  if (row.expiresAt.getTime() <= Date.now()) return null;

  // Defense-in-depth constant-time confirm. The indexed findUnique already
  // matched on tokenHash; this guards against any timing oracle in the
  // comparison path. Both sides are fixed-length SHA-256 hex, so there is no
  // length-difference branch to leak (timingSafeEqual requires equal length).
  const a = Buffer.from(row.tokenHash);
  const b = Buffer.from(tokenHash);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  // Fire-and-forget: do not await, do not block the feed on this write.
  void prisma.opdsToken
    .update({ where: { id: row.id }, data: { lastUsedAt: new Date() } })
    .catch(() => {
      // A failed lastUsedAt bump must never fail the request. Swallow it.
    });

  return row.user;
}

// The 401 the contract pins for any unauthenticated/invalid OPDS request.
// Carries WWW-Authenticate: Basic realm="homelab-reader OPDS" so standard OPDS
// clients prompt for credentials.
export function opdsChallenge(body = "Authentication required"): NextResponse {
  return new NextResponse(body, {
    status: 401,
    headers: { "WWW-Authenticate": OPDS_REALM },
  });
}
