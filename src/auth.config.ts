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
    authorized({ auth, request: { nextUrl } }) {
      const loggedIn = !!auth?.user;
      const { pathname } = nextUrl;

      // OPDS is the bridge to mobile clients, which authenticate with
      // HTTP Basic — not the browser session cookie. Leave it out of the
      // cookie gate; its own auth lands with the OPDS phase.
      if (pathname.startsWith("/api/opds")) return true;

      // First-run setup and the login form are reachable while signed out.
      // /setup closes itself once an admin exists (enforced in the page);
      // /login bounces an already-signed-in user back to the library.
      if (pathname.startsWith("/setup")) return true;
      if (pathname.startsWith("/login")) {
        if (loggedIn) return Response.redirect(new URL("/", nextUrl));
        return true;
      }

      return loggedIn;
    },
  },
  providers: [], // real providers are added in auth.ts (Node runtime)
} satisfies NextAuthConfig;
