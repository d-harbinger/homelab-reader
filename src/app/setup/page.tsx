import { redirect } from "next/navigation";
import { AuthError as NextAuthError } from "next-auth";
import { signIn } from "@/auth";
import { createUser, userCount, UserInputError } from "@/lib/users";
import {
  AuthShell,
  AuthField,
  AuthSubmit,
  AuthError,
} from "@/components/AuthShell";

// First-run only: create the admin account. Once any user exists, setup is
// closed and visitors are sent to the login form.
//
// Reads live DB state (userCount), so it must render per-request — statically
// prerendering at `next build` fails because no database exists at build time.
export const dynamic = "force-dynamic";

export default async function SetupPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  if ((await userCount()) > 0) redirect("/login");

  const { error } = await searchParams;

  async function createAdmin(formData: FormData) {
    "use server";
    // Guard against a second admin being created by a direct POST after the
    // first one already exists.
    if ((await userCount()) > 0) redirect("/login");

    const username = String(formData.get("username") ?? "");
    const password = String(formData.get("password") ?? "");
    const confirm = String(formData.get("confirm") ?? "");

    if (password !== confirm) {
      redirect(`/setup?error=${encodeURIComponent("Passwords don't match.")}`);
    }

    try {
      await createUser({ username, password, role: "admin" });
    } catch (e) {
      if (e instanceof UserInputError) {
        redirect(`/setup?error=${encodeURIComponent(e.message)}`);
      }
      throw e;
    }

    try {
      // Step 2 of first-run: the privacy choice (what may talk to the
      // internet) — asked once, in plain language, before the library
      // ever loads.
      await signIn("credentials", { username, password, redirectTo: "/setup/privacy" });
    } catch (e) {
      if (e instanceof NextAuthError) redirect("/login");
      throw e;
    }
  }

  return (
    <AuthShell
      title="Welcome to homelab-reader"
      subtitle="Create the admin account to get started"
      footer="This is the owner account — it can add and remove other users later."
    >
      <form action={createAdmin} className="space-y-4">
        <AuthField
          id="username"
          label="Admin username"
          autoComplete="username"
          autoFocus
        />
        <AuthField
          id="password"
          label="Password"
          type="password"
          autoComplete="new-password"
        />
        <AuthField
          id="confirm"
          label="Confirm password"
          type="password"
          autoComplete="new-password"
        />
        {error && <AuthError>{error}</AuthError>}
        <AuthSubmit>Create admin & sign in</AuthSubmit>
      </form>
    </AuthShell>
  );
}
