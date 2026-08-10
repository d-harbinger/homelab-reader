// The middleware's `authorized` gatekeeper (src/auth.config.ts) — tested as
// the pure decision function it is. The regression pinned here: a signed-in
// POST to /login must pass through to the server action, not be answered with
// a bare 302. The login form submits as a server-action POST, and a redirect
// response to that POST breaks the action protocol client-side ("An unexpected
// response was received from the server") — hit live when a session cookie
// re-appeared between clearing cookies and submitting the form.
import { describe, it, expect } from "vitest";
import { authConfig } from "@/auth.config";

type AuthParam = Parameters<typeof authConfig.callbacks.authorized>[0]["auth"];

function decide(path: string, method: string, loggedIn: boolean) {
  const nextUrl = new URL(`http://box.local:5456${path}`);
  const auth = (loggedIn ? { user: { name: "u" } } : null) as AuthParam;
  const request = { nextUrl, method } as unknown as Parameters<
    typeof authConfig.callbacks.authorized
  >[0]["request"];
  return authConfig.callbacks.authorized({ auth, request });
}

describe("middleware authorized gate", () => {
  it("bounces a signed-in GET /login back to the library", () => {
    const res = decide("/login", "GET", true);
    expect(res).toBeInstanceOf(Response);
    expect((res as Response).headers.get("location")).toBe(
      "http://box.local:5456/",
    );
  });

  it("lets a signed-in POST /login through to the server action", () => {
    expect(decide("/login", "POST", true)).toBe(true);
  });

  it("lets a signed-out visitor reach the login form", () => {
    expect(decide("/login", "GET", false)).toBe(true);
  });

  it("keeps protected pages closed while signed out", () => {
    expect(decide("/", "GET", false)).toBe(false);
    expect(decide("/books/abc", "GET", false)).toBe(false);
  });

  it("keeps the token-authenticated exemptions open", () => {
    expect(decide("/api/opds", "GET", false)).toBe(true);
    expect(decide("/api/opds/recent", "GET", false)).toBe(true);
    expect(decide("/api/covers/abc", "GET", false)).toBe(true);
    expect(decide("/api/books/abc/file", "GET", false)).toBe(true);
    // …but not the rest of /api/books
    expect(decide("/api/books", "GET", false)).toBe(false);
  });

  // The exemption used to be `pathname.startsWith("/api/opds")`, which also
  // matched /api/opds-TOKENS — the surface that MINTS those credentials. POST
  // there hands out a password-equivalent secret. The routes self-guarded, so
  // nothing was reachable in practice, but the cookie gate was lifted off a
  // credential-issuing endpoint by a prefix that was never meant to reach it,
  // and the two files disagreed in their comments about who was protecting it.
  it("GATES the OPDS token-management surface — it is not part of the feed", () => {
    expect(decide("/api/opds-tokens", "GET", false)).toBe(false);
    expect(decide("/api/opds-tokens", "POST", false)).toBe(false);
    expect(decide("/api/opds-tokens/abc", "DELETE", false)).toBe(false);
  });

  // Same class of bug, two more places: `startsWith("/setup")` also matched
  // /setupfoo and `startsWith("/login")` also matched /loginbar, so any future
  // route whose name merely began with one of those words would have been born
  // reachable while signed out.
  it("does not exempt paths that merely begin with an exempt word", () => {
    expect(decide("/setupfoo", "GET", false)).toBe(false);
    expect(decide("/loginbar", "GET", false)).toBe(false);
    expect(decide("/api/opdsfoo", "GET", false)).toBe(false);
    // The real ones still work, exact and as a parent.
    expect(decide("/setup", "GET", false)).toBe(true);
    expect(decide("/setup/privacy", "GET", false)).toBe(true);
    expect(decide("/login", "GET", false)).toBe(true);
  });
});
