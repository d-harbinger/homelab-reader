import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { authConfig } from "./auth.config";
import { prisma } from "@/lib/prisma";

// ── Login throttle ──────────────────────────────────────────
// The credentials login sits on the same LAN/OPDS-exposed surface as the sync
// API. bcrypt is the only cost on online guessing; a sliding-window per-username
// lockout raises the bar against brute-forcing a weak password. In-memory,
// per-process — sufficient for the single-container deployment, not distributed.
const LOGIN_WINDOW_MS = 15 * 60 * 1000; // failures counted within a 15-minute window
const LOGIN_MAX_FAILS = 10; // reject further attempts once this many fail in-window
const loginFails = new Map<string, number[]>(); // username(lower) → failure timestamps

// Recent (in-window) failures for a key, pruning expired entries as a side effect.
function recentLoginFails(key: string, now: number): number[] {
  const arr = (loginFails.get(key) ?? []).filter((t) => now - t < LOGIN_WINDOW_MS);
  if (arr.length) loginFails.set(key, arr);
  else loginFails.delete(key);
  return arr;
}

function recordLoginFail(key: string, now: number): void {
  const arr = recentLoginFails(key, now);
  arr.push(now);
  loginFails.set(key, arr);
}

// Full Node-runtime auth instance. Used by the API route handler and any
// server-side `auth()` call. The Credentials provider looks the account up
// by username and verifies the password against its bcrypt hash. Accounts
// are created at first-run setup or by an admin — see /setup and /api/users.
export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      credentials: {
        username: { label: "Username", type: "text" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        const username =
          typeof credentials?.username === "string"
            ? credentials.username.trim()
            : "";
        const password =
          typeof credentials?.password === "string"
            ? credentials.password
            : "";
        if (!username || !password) return null;

        // Throttle before spending a bcrypt compare: once too many recent
        // failures for this username, reject outright. Success clears the
        // counter. Same generic null return as any other failure, so this
        // never enables user enumeration.
        const throttleKey = username.toLowerCase();
        const now = Date.now();
        if (recentLoginFails(throttleKey, now).length >= LOGIN_MAX_FAILS) {
          console.warn(
            `[auth] too many failed logins for username=${JSON.stringify(username)} — locked up to ${LOGIN_WINDOW_MS / 60000}min`,
          );
          return null;
        }

        const user = await prisma.user.findUnique({ where: { username } });
        if (!user || !user.passwordHash) {
          recordLoginFail(throttleKey, now);
          return null;
        }

        const ok = await bcrypt.compare(password, user.passwordHash);
        if (!ok) {
          recordLoginFail(throttleKey, now);
          return null;
        }

        loginFails.delete(throttleKey);
        return { id: user.id, name: user.username, role: user.role };
      },
    }),
  ],
});
