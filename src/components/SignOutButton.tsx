"use client";

import { LogOut } from "lucide-react";
import { signOut } from "next-auth/react";

// Sign out by posting to Auth.js's own endpoint (/api/auth/signout), not by
// running a server action on the current page.
//
// The distinction is load-bearing. A server action posts back to the page it
// was rendered on, and every page is behind the session gate — so once the
// session has already lapsed (expired, or cleared by a sibling app sharing the
// cookie jar), the gate answers that POST with a redirect to /login. The
// client router cannot read a redirect as an action result and throws, which
// surfaces as a full-screen "Application error" at the exact moment the reader
// is trying to recover. The auth endpoint is excluded from the gate's matcher,
// so it can never be redirected: signing out works from a healthy session and
// from a dead one alike.
//
// signOut() from next-auth/react navigates the whole page to callbackUrl once
// the cookie is cleared, so nothing stale survives the transition.
export function SignOutButton() {
  return (
    <button
      type="button"
      onClick={() => void signOut({ callbackUrl: "/login" })}
      aria-label="Sign out"
      title="Sign out"
      className="rounded-md p-1.5 text-zinc-500 transition-colors hover:bg-zinc-900 hover:text-zinc-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/60"
    >
      <LogOut size={15} />
    </button>
  );
}
