import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { getCurrentUser } from "@/lib/current-user";
import { UserManager } from "@/components/UserManager";

// Admin-only. The middleware ensures a session; this enforces the role.
export default async function UsersSettingsPage() {
  const me = await getCurrentUser();
  if (!me) redirect("/login");
  if (me.role !== "admin") redirect("/");

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
          Users
        </h1>
        <p className="mt-1 text-sm text-zinc-500">
          Add readers, reset passwords, and manage who can administer the
          server. Each account keeps its own notes, highlights, and progress.
        </p>
      </div>

      <UserManager currentUserId={me.id} />
    </main>
  );
}
