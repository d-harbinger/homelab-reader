"use client";

import { useState } from "react";
import useSWR from "swr";
import { AlertTriangle, X } from "lucide-react";
import { fetcher } from "@/lib/fetcher";

interface FailureHint {
  meaning: string;
  fix: string;
  command?: string;
}

interface FailedImport {
  id: string;
  name: string;
  reason: string;
  format: string;
  failedAt: string;
  hint: FailureHint;
}

// A calm, dismissible notice listing books that failed to import — and,
// per entry, what the failure actually means and the way out (the raw
// parser reason stays visible for support, but the plain-language hint
// leads). Backed by the session-gated /api/scan/failures endpoint,
// which returns each file's basename (never its full path).
//
// Two kinds of dismissal, deliberately distinct:
//   × on the banner  = "I've seen it" (local, reappears next load)
//   Ignore on a row  = admin: "stop telling everyone about this file"
//     (persisted; the row resurfaces only if the file's contents change,
//     because a changed file clears its failure record on re-scan).
export function FailedImportsBanner() {
  const { data, mutate } = useSWR<{ failures: FailedImport[] }>(
    "/api/scan/failures",
    fetcher,
    { refreshInterval: 15000 },
  );
  const { data: me } = useSWR<{ user: { role: string } | null }>("/api/me", fetcher);
  const isAdmin = me?.user?.role === "admin";
  const [dismissed, setDismissed] = useState(false);
  const [open, setOpen] = useState<string | null>(null);

  async function ignore(id: string) {
    await fetch(`/api/scan/failures/${id}`, { method: "PATCH" }).catch(() => {});
    await mutate();
  }

  const failures = data?.failures ?? [];
  if (dismissed || failures.length === 0) return null;

  return (
    <div className="rounded-lg border border-amber-500/25 bg-amber-500/[0.06] px-4 py-3.5">
      <div className="flex items-start gap-3">
        <span
          aria-hidden
          className="mt-0.5 flex h-6 w-6 flex-none items-center justify-center rounded-md bg-amber-500/10 text-amber-400 ring-1 ring-inset ring-amber-500/20"
        >
          <AlertTriangle size={14} strokeWidth={1.75} />
        </span>
        <div className="min-w-0 flex-1 space-y-1.5">
          <p className="text-sm font-medium text-zinc-200">
            {failures.length === 1
              ? "A book couldn't be imported"
              : `${failures.length} books couldn't be imported`}
          </p>
          <p className="text-xs text-zinc-500">
            Fixing or replacing a file re-imports it automatically — no rescan
            needed. Click a file for what its error means and how to fix it.
          </p>
          <ul className="space-y-1.5 pt-0.5">
            {failures.map((f) => (
              <li key={f.id} className="text-xs text-zinc-400">
                <div className="flex items-baseline justify-between gap-3">
                  <button
                    onClick={() => setOpen(open === f.id ? null : f.id)}
                    className="min-w-0 truncate text-left font-medium text-zinc-300 underline-offset-2 hover:underline"
                  >
                    {f.name}
                  </button>
                  {isAdmin && (
                    <button
                      onClick={() => ignore(f.id)}
                      title="Stop showing this file (it resurfaces only if the file changes)"
                      className="flex-none text-zinc-600 transition-colors hover:text-zinc-300"
                    >
                      Ignore
                    </button>
                  )}
                </div>
                {open === f.id && (
                  <div className="mt-1.5 space-y-1.5 rounded-md border border-zinc-800 bg-zinc-900/60 p-2.5">
                    <p className="text-zinc-300">{f.hint.meaning}</p>
                    <p className="text-zinc-500">{f.hint.fix}</p>
                    {f.hint.command && (
                      <code className="block overflow-x-auto rounded bg-zinc-950 px-2 py-1.5 font-mono text-[11px] text-zinc-300">
                        {f.hint.command}
                      </code>
                    )}
                    <p className="text-zinc-600">
                      Importer said: <span className="text-zinc-500">{f.reason}</span>
                    </p>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
        <button
          onClick={() => setDismissed(true)}
          aria-label="Dismiss"
          title="Dismiss"
          className="flex-none rounded-md p-1 text-zinc-600 transition-colors hover:bg-zinc-800/60 hover:text-zinc-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/60"
        >
          <X size={14} />
        </button>
      </div>
    </div>
  );
}
