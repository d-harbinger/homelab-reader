import { NextResponse } from "next/server";
import { createHash, randomBytes } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { authError, getCurrentUserId } from "@/lib/current-user";

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
export async function GET() {
  let userId: string;
  try {
    userId = await getCurrentUserId();
  } catch (e) {
    return authError(e);
  }

  // Explicit select: id/label/createdAt/lastUsedAt only. tokenHash is never
  // selected, so it can never reach the client even by accident.
  const tokens = await prisma.opdsToken.findMany({
    where: { userId },
    select: { id: true, label: true, createdAt: true, lastUsedAt: true },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({ tokens });
}

// POST /api/opds-tokens — mint a token for the caller.
// Body: { label }
// Returns { id, label, createdAt, token } — the plaintext `token` is present
// ONLY on this response and is the single chance to copy it.
export async function POST(req: Request) {
  let userId: string;
  try {
    userId = await getCurrentUserId();
  } catch (e) {
    return authError(e);
  }

  let body: { label?: string };
  try {
    body = (await req.json()) as { label?: string };
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const label = typeof body.label === "string" ? body.label.trim() : "";
  if (!label) {
    return NextResponse.json({ error: "missing label" }, { status: 400 });
  }

  // High-entropy opaque secret. base64url so it travels cleanly in HTTP Basic
  // and Bearer. Stored only as its SHA-256 hex — never the plaintext.
  const token = randomBytes(32).toString("base64url");
  const tokenHash = createHash("sha256").update(token).digest("hex");

  const row = await prisma.opdsToken.create({
    data: { userId, tokenHash, label: label.slice(0, 200) },
  });

  // The plaintext `token` leaves the server here and nowhere else.
  return NextResponse.json(
    { id: row.id, label: row.label, createdAt: row.createdAt, token },
    { status: 201 },
  );
}
