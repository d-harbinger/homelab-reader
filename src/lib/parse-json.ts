import { NextResponse } from "next/server";

// parseJson<T>(req): read and parse the request body, returning a typed
// result-or-400. Replaces the inline `try { body = await req.json() } catch {
// return 400 "invalid json" }` block, preserving its exact 400 shape.
//
// This lives in its own module — separate from the auth wrappers in
// route-helpers.ts — so a route that only needs body-parsing (e.g. the
// OPDS-token-authed /api/opds/progress) can import it WITHOUT transitively
// pulling in next-auth via current-user/@auth. That import chain breaks
// resolution in tests that don't mock the auth seam.
export type ParseJsonResult<T> =
  | { ok: true; body: T }
  | { ok: false; res: NextResponse };

export async function parseJson<T>(req: Request): Promise<ParseJsonResult<T>> {
  try {
    return { ok: true, body: (await req.json()) as T };
  } catch {
    return {
      ok: false,
      res: NextResponse.json({ error: "invalid json" }, { status: 400 }),
    };
  }
}
