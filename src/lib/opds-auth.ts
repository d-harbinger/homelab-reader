import { NextResponse } from "next/server";
import { createHash, timingSafeEqual } from "node:crypto";
import { prisma } from "@/lib/prisma";
import type { User } from "@prisma/client";

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
export async function authenticateOpds(req: Request): Promise<User | null> {
  const token = extractToken(req);
  if (!token) return null;

  // High-entropy opaque secret, so a fast cryptographic hash is correct here
  // (bcrypt is for low-entropy passwords). Look the row up by the hash.
  const tokenHash = createHash("sha256").update(token).digest("hex");

  const row = await prisma.opdsToken.findUnique({
    where: { tokenHash },
    include: { user: true },
  });
  if (!row) return null;

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
