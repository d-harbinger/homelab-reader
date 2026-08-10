// Unit tests for the route-handler helpers (TEACHING #3).
//
// Two helpers under test, both in src/lib/route-helpers.ts:
//   - parseJson<T>(req): result-or-400 wrapper over req.json()
//   - withUser(handler) / withAdmin(handler): auth-first handler wrappers
//
// Branch enumeration:
//   parseJson:  valid json -> { ok: true, body }
//               invalid json -> { ok: false, res } where res is the exact
//               400 { error: "invalid json" } the routes returned inline.
//   withUser:   authed -> handler runs, receives the resolved user + ctx
//               signed out -> 401 { error: "unauthenticated" }, handler NOT run
//   withAdmin:  admin -> handler runs, receives the admin user + ctx
//               reader -> 403 { error: "forbidden" }, handler NOT run
//               signed out -> 401 { error: "unauthenticated" }, handler NOT run
//   ordering:   auth resolves BEFORE the handler body — a handler spy must not
//               be called on any auth-failure path.
//
// The auth seam is the same one authz-gates.test.ts mocks: auth() from
// "@/auth". Mocking it lets the real getCurrentUser / requireAdmin logic in
// src/lib/current-user.ts run against a fake session.

import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextResponse } from "next/server";

vi.mock("@/auth", () => ({ auth: vi.fn() }));
// The gate re-reads the User row, so the row lookup needs an answer too. This
// stand-in serves it from the same session the auth mock is driving — see
// tests/helpers/prisma-user-mock.ts. No other model is available, which keeps
// this suite honestly about the gate and nothing else.
vi.mock("@/lib/prisma", () => import("./helpers/prisma-user-mock"));


import {
  parseJson,
  withUser,
  withAdmin,
  type IdContext,
} from "@/lib/route-helpers";
import type { CurrentUser } from "@/lib/current-user";
// The shared helpers, not a local copy: setting a session now has to drive BOTH
// halves of the seam (the auth() claim and the User row the gate re-reads), and
// a private setSession that only did the first would authenticate nobody.
import { signOut, asReader, asAdmin } from "./helpers/auth-mock";

const jsonReq = (body: unknown) =>
  new Request("http://test/api", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
const rawReq = (raw: string) =>
  new Request("http://test/api", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: raw,
  });
const idCtx = (id = "any-id") => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  vi.clearAllMocks();
  signOut();
});

// ---------------------------------------------------------------------------
// parseJson
// ---------------------------------------------------------------------------
describe("parseJson", () => {
  it("valid json -> { ok: true, body }", async () => {
    const result = await parseJson<{ a: number }>(jsonReq({ a: 1 }));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.body).toEqual({ a: 1 });
  });

  it("invalid json -> { ok: false } with the exact 400 response shape", async () => {
    const result = await parseJson(rawReq("{not json"));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.res.status).toBe(400);
      expect(await result.res.json()).toEqual({ error: "invalid json" });
    }
  });
});

// ---------------------------------------------------------------------------
// withUser
// ---------------------------------------------------------------------------
describe("withUser", () => {
  it("authed -> handler runs and receives the resolved user + ctx", async () => {
    asReader("u-1");
    const handler =
      vi.fn<(user: CurrentUser, req: Request, ctx: IdContext) => Promise<NextResponse>>(
        async () => NextResponse.json({ ok: true }),
      );
    const wrapped = withUser<IdContext>(handler);
    const res = await wrapped(new Request("http://test/api"), idCtx("ctx-id"));

    expect(res.status).toBe(200);
    expect(handler).toHaveBeenCalledTimes(1);
    const [user, , ctx] = handler.mock.calls[0];
    // The resolved user is the DATABASE ROW, not the token claim — hence the
    // username, which only the row carries.
    expect(user).toEqual({ id: "u-1", username: "session-u-1", role: "reader" });
    expect(await ctx.params).toEqual({ id: "ctx-id" });
  });

  it("signed out -> 401 and the handler is NOT called (auth before body)", async () => {
    signOut();
    const handler = vi.fn(async () => NextResponse.json({ ok: true }));
    const wrapped = withUser(handler);
    const res = await wrapped(new Request("http://test/api"));

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthenticated" });
    expect(handler).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// withAdmin
// ---------------------------------------------------------------------------
describe("withAdmin", () => {
  it("admin -> handler runs and receives the admin user", async () => {
    asAdmin("a-1");
    const handler = vi.fn<(admin: CurrentUser) => Promise<NextResponse>>(
      async () => NextResponse.json({ ok: true }),
    );
    const wrapped = withAdmin(handler);
    const res = await wrapped(new Request("http://test/api"));

    expect(res.status).toBe(200);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0]).toEqual({
      id: "a-1",
      username: "session-a-1",
      role: "admin",
    });
  });

  it("reader -> 403 and the handler is NOT called", async () => {
    asReader("u-1");
    const handler = vi.fn(async () => NextResponse.json({ ok: true }));
    const wrapped = withAdmin(handler);
    const res = await wrapped(new Request("http://test/api"));

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "forbidden" });
    expect(handler).not.toHaveBeenCalled();
  });

  it("signed out -> 401 and the handler is NOT called", async () => {
    signOut();
    const handler = vi.fn(async () => NextResponse.json({ ok: true }));
    const wrapped = withAdmin(handler);
    const res = await wrapped(new Request("http://test/api"));

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthenticated" });
    expect(handler).not.toHaveBeenCalled();
  });
});
