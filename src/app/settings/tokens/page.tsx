import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { getCurrentUser } from "@/lib/current-user";
import { TokenManager } from "@/components/TokenManager";

// Per-user, NOT admin-gated: every signed-in account manages its own OPDS
// tokens. The middleware ensures a session; we only redirect signed-out
// visitors (no role check, unlike the users/libraries settings pages).
export default async function TokensSettingsPage() {
  const me = await getCurrentUser();
  if (!me) redirect("/login");

  return (
    <main className="mx-auto max-w-3xl px-6 py-10 space-y-8">
      <div>
        <Link
          href="/"
          className="inline-flex items-center gap-2 text-xs text-zinc-500 transition-colors hover:text-zinc-200"
        >
          <ArrowLeft size={14} />
          Library
        </Link>
        <h1 className="mt-4 text-2xl font-semibold tracking-tight text-zinc-100">
          OPDS Tokens
        </h1>
        <p className="mt-1 text-sm text-zinc-500">
          App passwords for OPDS clients — android-reader and standard readers
          sign in with one of these instead of the login password. A token is
          shown once at creation, then stored hashed and never displayed again.
          Revoking one disconnects that client without changing the account
          password.
        </p>
      </div>

      <TokenManager />
    </main>
  );
}
