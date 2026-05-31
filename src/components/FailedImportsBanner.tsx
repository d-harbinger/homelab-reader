"use client";

import { useState } from "react";
import useSWR from "swr";
import { AlertTriangle, X } from "lucide-react";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface FailedImport {
  id: string;
  name: string;
  reason: string;
  format: string;
  failedAt: string;
}

// A calm, dismissible notice listing books that failed to import. Backed by the
// session-gated /api/scan/failures endpoint, which returns each file's basename
// (never its full path) plus the recorded reason.
//
// Tone matches the rest of the library shell: zinc surface, amber accent for
// the "needs a look" signal — informative, not alarming. Dismiss is local
// state; if the failures persist they reappear on the next page load, so a
// dismiss is "I've seen it," not "resolve it."
export function FailedImportsBanner() {
  const { data } = useSWR<{ failures: FailedImport[] }>(
    "/api/scan/failures",
    fetcher,
    { refreshInterval: 15000 },
  );
  const [dismissed, setDismissed] = useState(false);

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
            {"These files are in a watched folder but their contents couldn't be read. Re-export or replace them and they'll import automatically."}
          </p>
          <ul className="space-y-1 pt-0.5">
            {failures.map((f) => (
              <li key={f.id} className="text-xs text-zinc-400">
                <span className="font-medium text-zinc-300">{f.name}</span>
                <span className="text-zinc-600">{"  —  "}</span>
                <span className="text-zinc-500">{f.reason}</span>
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
