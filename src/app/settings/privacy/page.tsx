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
  const { data, mutate } = useSWR<{ onlineLookups: boolean; decided: boolean }>(
    "/api/settings/privacy",
    fetcher,
  );
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
          When allowed, the reader can look books up on OpenLibrary.org (a free
          service by the nonprofit Internet Archive) to fill in missing covers,
          authors, and shelves. Each lookup sends that book&apos;s title,
          author, and ISBN — and this server&apos;s IP address — to OpenLibrary;
          a third party could learn what books are in this library. Lookups run
          only when someone triggers them (importing a book with thin metadata,
          or the Sort page&apos;s lookup button). When off, this install sends
          nothing anywhere. Everything else — reading, notes, highlights,
          shelves — is always fully local either way.
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
    </main>
  );
}
