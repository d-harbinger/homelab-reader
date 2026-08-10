import { NextResponse } from "next/server";
import { createHash, randomBytes } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { parseJson, withUser } from "@/lib/route-helpers";
import { TOKEN_LIFETIME_DAYS, tokenExpiry } from "@/lib/opds-auth";

// OPDS token management REST, under the COOKIE session (the web UI). These are
// the per-user "app passwords" OPDS clients (android-reader and standard
// readers) send on every request; see docs/OPDS-AUTH-CONTRACT.md. The login
// password is never reused, and a token is revocable without changing it.
//
// The plaintext token is generated here, hashed for storage, and returned to
// the caller EXACTLY ONCE — on the POST mint response. It is never persisted in
// plaintext, never logged, and never returned by GET. The list deliberately
// selects only non-secret columns so the hash can never leak.

// GET /api/opds-tokens — list the caller's own tokens (no token, no hash).
export const GET = withUser(async (user) => {
  // Explicit select: id/label/createdAt/lastUsedAt only. tokenHash is never
  // selected, so it can never reach the client even by accident.
  const tokens = await prisma.opdsToken.findMany({
    where: { userId: user.id },
    select: {
      id: true,
      label: true,
      createdAt: true,
      lastUsedAt: true,
      expiresAt: true,
    },
    orderBy: { createdAt: "desc" },
  });

  // `expired` is computed here rather than left to the browser: the server owns
  // the clock that the guard actually checks against, and a client whose clock
  // is wrong would otherwise show a live token as dead or the reverse.
  const now = Date.now();
  return NextResponse.json({
    tokens: tokens.map((t) => ({
      ...t,
      expired: t.expiresAt.getTime() <= now,
    })),
  });
});

// POST /api/opds-tokens — mint a token for the caller.
// Body: { label }
// Returns { id, label, createdAt, token } — the plaintext `token` is present
// ONLY on this response and is the single chance to copy it.
export const POST = withUser(async (user, req) => {
  const parsed = await parseJson<{ label?: string }>(req);
  if (!parsed.ok) return parsed.res;

  const label = typeof parsed.body.label === "string" ? parsed.body.label.trim() : "";
  if (!label) {
    return NextResponse.json({ error: "missing label" }, { status: 400 });
  }

  // High-entropy opaque secret. base64url so it travels cleanly in HTTP Basic
  // and Bearer. Stored only as its SHA-256 hex — never the plaintext.
  const token = randomBytes(32).toString("base64url");
  const tokenHash = createHash("sha256").update(token).digest("hex");

  const row = await prisma.opdsToken.create({
    data: {
      userId: user.id,
      tokenHash,
      label: label.slice(0, 200),
      // Every token gets an end date at birth. See TOKEN_LIFETIME_DAYS.
      expiresAt: tokenExpiry(),
    },
  });

  // The plaintext `token` leaves the server here and nowhere else. The expiry
  // rides along so the one-time reveal can say how long it is good for — the
  // moment the user is pairing a device is the moment that matters.
  return NextResponse.json(
    {
      id: row.id,
      label: row.label,
      createdAt: row.createdAt,
      expiresAt: row.expiresAt,
      lifetimeDays: TOKEN_LIFETIME_DAYS,
      token,
    },
    { status: 201 },
  );
});
