import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/current-user";
import {
  ONLINE_LOOKUPS_KEY,
  onlineLookupsDecided,
  setSetting,
} from "@/lib/app-settings";
import { AuthShell } from "@/components/AuthShell";

// First-run step 2: the honest-egress choice. This install sends
// NOTHING anywhere until this question is answered "yes" — and the
// question states in plain language exactly what would leave. Asked
// once; changeable any time under Settings → Privacy.
export const dynamic = "force-dynamic";

export default async function SetupPrivacyPage() {
  await requireAdmin().catch(() => redirect("/login"));
  if (await onlineLookupsDecided()) redirect("/");

  async function choose(formData: FormData) {
    "use server";
    await requireAdmin().catch(() => redirect("/login"));
    const enable = formData.get("choice") === "enable";
    await setSetting(ONLINE_LOOKUPS_KEY, enable ? "on" : "off");
    redirect("/");
  }

  return (
    <AuthShell
      title="One privacy choice"
      subtitle="What may this reader send to the internet?"
      footer="Changeable any time under Settings → Privacy. Everything else — reading, notes, highlights, shelves — is always fully local."
    >
      <div className="space-y-4 text-sm text-zinc-300">
        <p>
          The reader can look books up on{" "}
          <span className="text-zinc-100">OpenLibrary.org</span> (a free
          service by the nonprofit Internet Archive) to fill in missing
          covers, authors, and shelves — useful because most PDFs carry no
          metadata of their own.
        </p>
        <p className="rounded-md border border-zinc-800 bg-zinc-900/60 p-3 text-xs text-zinc-400">
          If enabled, each lookup sends the book&apos;s <b>title, author, and
          ISBN</b>, plus this server&apos;s IP address, to OpenLibrary — so
          OpenLibrary can see which books are looked up. Nothing else is sent,
          lookups run only when triggered from this app, and nothing is sent
          at all while this is off.
        </p>
        <form action={choose} className="space-y-3">
          <button
            type="submit"
            name="choice"
            value="enable"
            className="w-full rounded-md bg-amber-500 py-2 text-sm font-medium text-zinc-950 transition-colors hover:bg-amber-400"
          >
            Allow OpenLibrary lookups
          </button>
          <button
            type="submit"
            name="choice"
            value="offline"
            className="w-full rounded-md border border-zinc-700 py-2 text-sm font-medium text-zinc-200 transition-colors hover:bg-zinc-900"
          >
            Keep everything offline
          </button>
        </form>
      </div>
    </AuthShell>
  );
}
