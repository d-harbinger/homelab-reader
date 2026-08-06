import type { NextAuthConfig } from "next-auth";

// Edge-safe auth config: shared by the middleware (Edge runtime) and the
// full server instance in auth.ts. Nothing here may import bcrypt or
// Prisma — those are Node-only and live in auth.ts's Credentials provider.
//
// The session is a JWT (required: Credentials providers can't use database
// sessions, and the middleware decodes the token at the edge). The single
// user's id rides in the token so server routes can attribute notes,
// highlights, and progress to a real User row.

// Cookies are scoped by HOST NAME, not by port. Several apps published from
// one box therefore share one cookie jar, and with Auth.js's default names
// they all reach for "authjs.session-token". That is not a benign collision:
// each app signs its token with its own AUTH_SECRET, and Auth.js DELETES a
// session cookie it cannot verify — so opening the sibling app silently wipes
// this one's session, which reads as "sign in again on every refresh".
// App-unique names keep the sessions independent.
//
// `secure` is DERIVED from the deployment's own address rather than written
// into the code. A Secure cookie is discarded by the browser over plain HTTP
// (nobody can sign in), and a non-Secure one behind TLS leaks the session to
// any downgraded request. AUTH_URL is the single deployment answer that
// settles it — see docker-compose.yml and ./launch.sh.
//
// No `domain` attribute on purpose: the cookie stays on the exact host that
// issued it rather than spreading across sibling names.
const secure = (process.env.AUTH_URL ?? "").startsWith("https://");
const cookieOptions = {
  httpOnly: true,
  sameSite: "lax",
  path: "/",
  secure,
} as const;

export const authConfig = {
  // Self-hosted on the LAN behind an arbitrary host/port — not Vercel — so
  // Auth.js must trust the incoming Host header. Without this it rejects
  // every request with UntrustedHost.
  trustHost: true,
  pages: { signIn: "/login" },
  session: { strategy: "jwt" },
  // These MUST live in this shared config, not in auth.ts alone: the Edge
  // middleware builds its own NextAuth instance from this file, and a
  // middleware that does not know the cookie name looks for the default,
  // never finds the session, and bounces every signed-in request to /login.
  cookies: {
    sessionToken: { name: "homelab-reader.session-token", options: cookieOptions },
    csrfToken: { name: "homelab-reader.csrf-token", options: cookieOptions },
    callbackUrl: { name: "homelab-reader.callback-url", options: cookieOptions },
  },
  callbacks: {
    jwt({ token, user }) {
      if (user?.id) token.id = user.id;
      if (user?.role) token.role = user.role;
      return token;
    },
    session({ session, token }) {
      if (session.user) {
        if (token.id) session.user.id = token.id as string;
        if (token.role) session.user.role = token.role as string;
      }
      return session;
    },
    // Gatekeeper for matched routes (see middleware matcher). Returning
    // false bounces an unauthenticated request to /login.
    authorized({ auth, request }) {
      const { nextUrl } = request;
      const loggedIn = !!auth?.user;
      const { pathname } = nextUrl;

      // OPDS is the bridge to mobile clients, which authenticate with a
      // per-user HTTP Basic/Bearer token — not the browser session cookie.
      // It stays out of the cookie gate; auth is enforced in-route by
      // authenticateOpds (src/lib/opds-auth.ts), which 401s any request
      // without a valid token. Every OPDS route, current and future, must
      // call that guard.
      if (pathname.startsWith("/api/opds")) return true;

      // The OPDS acquisition feed links book bytes at /api/books/[id]/file and
      // covers at /api/covers/[id], so both are fetched by OPDS clients (token,
      // no cookie) as well as the browser reader. Like /api/opds they leave the
      // cookie gate and authenticate in-route via authenticateReaderRequest
      // (cookie OR token) — so a token-only client is not bounced to /login,
      // and because the routes self-guard the exemption never leaves them open.
      // The /file match is narrow on purpose: the rest of /api/books (listing,
      // metadata, facets) stays cookie-gated.
      if (pathname.startsWith("/api/covers/")) return true;
      if (pathname.startsWith("/api/books/") && pathname.endsWith("/file"))
        return true;

      // First-run setup and the login form are reachable while signed out.
      // /setup closes itself once an admin exists (enforced in the page);
      // /login bounces an already-signed-in user back to the library — but
      // ONLY on GET. The login form submits as a server-action POST to
      // /login, and answering that POST with a bare 302 breaks the action
      // protocol (the client shows "unexpected response from the server"
      // and never navigates). A signed-in POST happens in real life — two
      // tabs, a session restored mid-form — and signing in again is the
      // correct, harmless outcome, so let the action run.
      if (pathname.startsWith("/setup")) return true;
      if (pathname.startsWith("/login")) {
        if (loggedIn && request.method === "GET")
          return Response.redirect(new URL("/", nextUrl));
        return true;
      }

      return loggedIn;
    },
  },
  providers: [], // real providers are added in auth.ts (Node runtime)
} satisfies NextAuthConfig;
