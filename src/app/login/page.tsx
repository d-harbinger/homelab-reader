import { redirect } from "next/navigation";
import { AuthError as NextAuthError } from "next-auth";
import { signIn } from "@/auth";
import { userCount } from "@/lib/users";
import {
  AuthShell,
  AuthField,
  AuthSubmit,
  AuthError,
} from "@/components/AuthShell";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  // No accounts yet → send the first visitor to create the admin.
  if ((await userCount()) === 0) redirect("/setup");

  const { error } = await searchParams;

  async function login(formData: FormData) {
    "use server";
    try {
      await signIn("credentials", {
        username: formData.get("username"),
        password: formData.get("password"),
        redirectTo: "/",
      });
    } catch (e) {
      // A successful sign-in throws a NEXT_REDIRECT we must let propagate;
      // only an AuthError means bad credentials.
      if (e instanceof NextAuthError) redirect("/login?error=1");
      throw e;
    }
  }

  return (
    <AuthShell title="homelab-reader" subtitle="Sign in to your library">
      <form action={login} className="space-y-4">
        <AuthField
          id="username"
          label="Username"
          autoComplete="username"
          autoFocus
        />
        <AuthField
          id="password"
          label="Password"
          type="password"
          autoComplete="current-password"
        />
        {error && <AuthError>Incorrect username or password.</AuthError>}
        <AuthSubmit>Sign in</AuthSubmit>
      </form>
    </AuthShell>
  );
}
