import NextAuth from "next-auth";
import { authConfig } from "./auth.config";

// The `authorized` callback in authConfig decides who gets through.
export default NextAuth(authConfig).auth;

export const config = {
  // Run on everything except NextAuth's own endpoints, Next internals,
  // and static assets. The `authorized` callback handles the rest,
  // including the /login and /api/opds exemptions.
  //
  // "/" is listed on its own because under a basePath the pattern below does
  // not match the mount root (Next.js issue #73786: the path it tests is the
  // empty string, not "/"), which would leave the shelf's own page ungated.
  matcher: ["/", "/((?!api/auth|_next/static|_next/image|favicon.ico).*)"],
};
