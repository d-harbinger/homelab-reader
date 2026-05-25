import type { DefaultSession } from "next-auth";

// Carry the User row id and role through the session and JWT so server code
// can attribute data to the right User and gate admin-only actions without
// a second lookup.
declare module "next-auth" {
  interface Session {
    user: { id: string; role: string } & DefaultSession["user"];
  }
  interface User {
    id?: string;
    role?: string;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id?: string;
    role?: string;
  }
}
