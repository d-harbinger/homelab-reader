// CSRF — the port-blind cookie.
//
// The session cookie is SameSite=Lax. "Same site" is decided by the registrable
// domain and ignores the port, so every application published from this host is
// same-site to every other one: this app on its port, and the sibling apps on
// theirs, all share one cookie jar's notion of "site". A page on any one of
// those origins — hostile, or merely carrying an injected script — can post to
// this application and the browser attaches this application's cookie.
//
// `Content-Type: text/plain` makes such a request "simple", so no preflight
// stands in the way, and `req.json()` parses the body regardless of the type
// the sender declared. Both are exercised below.
//
// The guard (src/lib/same-origin.ts) sits in the shared route wrappers, so a
// route inherits it rather than remembering it.

import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextResponse } from "next/server";

vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/prisma", () => import("./helpers/prisma-user-mock"));

import { asAdmin, asReader, signOut } from "./helpers/auth-mock";
import { withUser, withAdmin } from "@/lib/route-helpers";

const SELF = "http://box.local:5456";
// The sibling application on the same host. Different port, SAME SITE as far as
// the cookie is concerned — this is the origin the fix exists to refuse.
const SIBLING = "http://box.local:5454";

beforeEach(() => {
  vi.clearAllMocks();
  signOut();
});

function post(origin: string | null, contentType = "application/json") {
  const headers: Record<string, string> = { "content-type": contentType, host: "box.local:5456" };
  if (origin !== null) headers.origin = origin;
  return new Request(`${SELF}/api/thing`, {
    method: "POST",
    headers,
    body: JSON.stringify({ hello: "world" }),
  });
}

const spy = () => vi.fn(async () => NextResponse.json({ ok: true }));

describe("cross-origin writes are refused before anything else happens", () => {
  it("refuses a POST from a sibling application on the same host", async () => {
    asReader("u-1");
    const handler = spy();
    const res = await withUser(handler)(post(SIBLING));

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "cross-origin" });
    expect(handler).not.toHaveBeenCalled();
  });

  it("refuses it on the admin wrapper too", async () => {
    asAdmin("a-1");
    const handler = spy();
    const res = await withAdmin(handler)(post(SIBLING));

    expect(res.status).toBe(403);
    expect(handler).not.toHaveBeenCalled();
  });

  it("refuses a text/plain POST — the preflight-free shape", async () => {
    // A cross-site fetch with Content-Type: text/plain is a "simple request":
    // the browser sends it without asking permission first. The server-side
    // check is the only thing between it and the handler.
    asReader("u-1");
    const handler = spy();
    const res = await withUser(handler)(post(SIBLING, "text/plain"));

    expect(res.status).toBe(403);
    expect(handler).not.toHaveBeenCalled();
  });

  it("refuses Origin: null (sandboxed iframe, opaque redirect chain)", async () => {
    asReader("u-1");
    const handler = spy();
    const res = await withUser(handler)(post("null"));

    expect(res.status).toBe(403);
    expect(handler).not.toHaveBeenCalled();
  });

  it("refuses when only a cross-origin Referer is present", async () => {
    asReader("u-1");
    const handler = spy();
    const req = new Request(`${SELF}/api/thing`, {
      method: "POST",
      headers: { host: "box.local:5456", referer: `${SIBLING}/some/page` },
      body: "{}",
    });
    const res = await withUser(handler)(req);

    expect(res.status).toBe(403);
    expect(handler).not.toHaveBeenCalled();
  });

  it("refuses the same host on a different port", async () => {
    // Spelled out separately because this is the property SameSite does not
    // have: the port is part of the identity here.
    asReader("u-1");
    const handler = spy();
    const res = await withUser(handler)(post("http://box.local:5459"));
    expect(res.status).toBe(403);
  });
});

describe("legitimate traffic is untouched", () => {
  it("allows a POST from this application's own origin", async () => {
    asReader("u-1");
    const handler = spy();
    const res = await withUser(handler)(post(SELF));

    expect(res.status).toBe(200);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("allows a GET from a sibling origin — safe methods do not write", async () => {
    asReader("u-1");
    const handler = spy();
    const req = new Request(`${SELF}/api/thing`, {
      method: "GET",
      headers: { host: "box.local:5456", origin: SIBLING },
    });
    const res = await withUser(handler)(req);

    expect(res.status).toBe(200);
  });

  it("allows a POST that states no origin at all", async () => {
    // Not a hole: a browser attaches Origin to every request whose method is
    // not GET/HEAD and a page cannot suppress it, so a forgery always states
    // one. A request with no Origin is a direct client — curl, a script, an
    // OPDS reader — which has no ambient cookie to borrow in the first place.
    // Refusing these would break real machine clients and close nothing.
    asReader("u-1");
    const handler = spy();
    const res = await withUser(handler)(post(null));

    expect(res.status).toBe(200);
  });
});
