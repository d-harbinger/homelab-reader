"use client";

import Link from "next/link";
import useSWR from "swr";
import { useState } from "react";
import { ArrowLeft } from "lucide-react";
import { fetcher } from "@/lib/fetcher";

// Settings → Privacy: the one place that controls what this install may
// send to the internet, stated in the same plain language the setup
// step uses. Admin-only writes; everyone can read the state.
export default function PrivacySettingsPage() {
  const { data, mutate } = useSWR<{
    onlineLookups: boolean;
    decided: boolean;
    lookedUpBooks: number;
    purgeableRows: number;
  }>("/api/settings/privacy", fetcher);
  const { data: me } = useSWR<{ user: { role: string } | null }>("/api/me", fetcher);
  const isAdmin = me?.user?.role === "admin";
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function setLookups(enable: boolean) {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/settings/privacy", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ onlineLookups: enable }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await mutate();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const on = data?.onlineLookups ?? false;
  const [purgeMsg, setPurgeMsg] = useState("");

  async function purge() {
    setBusy(true);
    setPurgeMsg("");
    try {
      const res = await fetch("/api/settings/privacy", { method: "DELETE" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const r = (await res.json()) as { purged: number };
      setPurgeMsg(`Removed ${r.purged} result${r.purged === 1 ? "" : "s"}.`);
      await mutate();
    } catch (err) {
      setPurgeMsg(`Purge failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto max-w-2xl px-6 py-10 space-y-6">
      <div className="flex items-center justify-between">
        <Link
          href="/"
          className="inline-flex items-center gap-2 text-xs text-zinc-500 hover:text-zinc-200 transition-colors"
        >
          <ArrowLeft size={14} />
          Library
        </Link>
        <h1 className="text-lg font-semibold text-zinc-100">Privacy</h1>
      </div>

      <section className="space-y-3 rounded-md border border-zinc-800 p-4">
        <h2 className="text-sm font-medium text-zinc-100">
          OpenLibrary lookups — currently{" "}
          <span className={on ? "text-amber-400" : "text-zinc-400"}>
            {on ? "allowed" : "off"}
          </span>
        </h2>
        <p className="text-xs text-zinc-400">
          Fills in missing covers, authors, and shelves using OpenLibrary.org
          (run by the Internet Archive). Each lookup sends the book&apos;s
          title, author, and ISBN, plus this server&apos;s IP address — so
          OpenLibrary can see which books are looked up. Lookups run only when
          triggered: importing a book with thin metadata, or the lookup button
          on the Sort page. When off, the app makes no outbound requests.
          Reading, notes, highlights, and shelves are always stored locally.
        </p>
        {isAdmin ? (
          <button
            onClick={() => setLookups(!on)}
            disabled={busy}
            className="rounded-md bg-amber-500 px-3 py-1.5 text-xs font-medium text-zinc-950 transition-colors hover:bg-amber-400 disabled:opacity-50"
          >
            {busy ? "Saving…" : on ? "Turn lookups off" : "Allow lookups"}
          </button>
        ) : (
          <p className="text-xs text-zinc-600">An admin can change this.</p>
        )}
        {error && <p className="text-xs text-red-400">{error}</p>}
      </section>

      <section className="space-y-3 rounded-md border border-zinc-800 p-4">
        <h2 className="text-sm font-medium text-zinc-100">Stored lookup data</h2>
        <p className="text-xs text-zinc-400">
          {data ? (
            data.lookedUpBooks === 0 ? (
              "No lookup results are stored."
            ) : (
              <>
                <b className="text-zinc-200">{data.lookedUpBooks}</b>{" "}
                book{data.lookedUpBooks === 1 ? " has" : "s have"} lookup
                results stored locally; {data.purgeableRows} of those results
                were never applied. Applied results are part of a book&apos;s
                metadata and are managed on its page.
              </>
            )
          ) : (
            "Loading…"
          )}
        </p>
        {isAdmin && (data?.purgeableRows ?? 0) > 0 && (
          <button
            onClick={purge}
            disabled={busy}
            className="rounded-md border border-zinc-700 px-3 py-1.5 text-xs font-medium text-zinc-200 transition-colors hover:bg-zinc-900 disabled:opacity-50"
          >
            {busy ? "Removing…" : `Remove ${data!.purgeableRows} unapplied results`}
          </button>
        )}
        {purgeMsg && <p className="text-xs text-zinc-400">{purgeMsg}</p>}
      </section>
    </main>
  );
}
