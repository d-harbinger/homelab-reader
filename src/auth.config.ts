import type { NextAuthConfig } from "next-auth";

// Edge-safe auth config: shared by the middleware (Edge runtime) and the
// full server instance in auth.ts. Nothing here may import bcrypt or
// Prisma — those are Node-only and live in auth.ts's Credentials provider.
//
// The session is a JWT (required: Credentials providers can't use database
// sessions, and the middleware decodes the token at the edge). The single
// user's id rides in the token so server routes can attribute notes,
// highlights, and progress to a real User row.
export const authConfig = {
  // Self-hosted on the LAN behind an arbitrary host/port — not Vercel — so
  // Auth.js must trust the incoming Host header. Without this it rejects
  // every request with UntrustedHost.
  trustHost: true,
  pages: { signIn: "/login" },
  session: { strategy: "jwt" },
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
