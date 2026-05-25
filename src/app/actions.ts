"use server";

import { signOut } from "@/auth";

// Ends the session and returns to the login screen. Used by the header
// sign-out button (a client component invoking this server action).
export async function doSignOut() {
  await signOut({ redirectTo: "/login" });
}
