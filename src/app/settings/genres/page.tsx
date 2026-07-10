import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { getCurrentUser } from "@/lib/current-user";
import { GenreManager } from "@/components/GenreManager";

// Admin-only. The middleware ensures a session; this enforces the role.
export default async function GenresSettingsPage() {
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
          Genres
        </h1>
        <p className="mt-1 text-sm text-zinc-500">
          Genres are your top-level library folders. Reorder them, rename how
          they appear on the home page, or hide ones you don&apos;t want shown.
          This changes display only — your files and folders on disk are never
          touched.
        </p>
      </div>

      <GenreManager />
    </main>
  );
}
