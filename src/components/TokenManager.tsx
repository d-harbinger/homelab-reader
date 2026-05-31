"use client";

import { useState, type FormEvent } from "react";
import useSWR from "swr";
import { Check, Copy, KeyRound, Plus, Trash2 } from "lucide-react";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface TokenRow {
  id: string;
  label: string;
  createdAt: string;
  lastUsedAt: string | null;
}

// The mint response carries the plaintext token EXACTLY ONCE. We hold it in
// component state only until the user dismisses the banner, then drop it. It is
// never re-fetched and never appears in the list view.
interface MintedToken {
  id: string;
  label: string;
  token: string;
}

export function TokenManager() {
  const { data, mutate, isLoading } = useSWR<{ tokens: TokenRow[] }>(
    "/api/opds-tokens",
    fetcher,
  );
  const tokens = data?.tokens ?? [];
  const [minted, setMinted] = useState<MintedToken | null>(null);

  return (
    <div className="space-y-8">
      {minted && (
        <MintedBanner minted={minted} onDismiss={() => setMinted(null)} />
      )}

      <MintForm
        onMinted={(m) => {
          setMinted(m);
          mutate();
        }}
      />

      <div className="space-y-2">
        <h2 className="text-xs uppercase tracking-wider text-zinc-500">
          Tokens{" "}
          {tokens.length > 0 && (
            <span className="text-zinc-700">{tokens.length}</span>
          )}
        </h2>
        {isLoading ? (
          <p className="text-sm text-zinc-600">Loading…</p>
        ) : tokens.length === 0 ? (
          <p className="text-sm text-zinc-600">
            No tokens yet. Mint one above to connect an OPDS client.
          </p>
        ) : (
          <ul className="divide-y divide-zinc-900 rounded-lg border border-zinc-900">
            {tokens.map((t) => (
              <TokenRowItem key={t.id} token={t} onRevoked={() => mutate()} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

// The one-time reveal. Shows the plaintext token with a copy button and an
// unmissable "you won't see this again" note. Dismissing clears it from state.
function MintedBanner({
  minted,
  onDismiss,
}: {
  minted: MintedToken;
  onDismiss: () => void;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(minted.token);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard can be blocked (no secure context / denied permission). The
      // token is still selectable in the field, so this is non-fatal.
    }
  }

  return (
    <div className="space-y-3 rounded-lg border border-amber-500/30 bg-amber-500/5 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-medium text-amber-200">
            Token for “{minted.label}” created
          </h2>
          <p className="mt-1 text-xs text-amber-300/80">
            Copy it now and store it in your OPDS client — you won&apos;t see it
            again. It is stored hashed; no one can recover the plaintext later.
          </p>
        </div>
        <button
          onClick={onDismiss}
          className="shrink-0 rounded px-2 py-1 text-xs text-amber-300/70 transition-colors hover:text-amber-200"
        >
          Done
        </button>
      </div>
      <div className="flex items-center gap-2">
        <input
          readOnly
          value={minted.token}
          onFocus={(e) => e.currentTarget.select()}
          aria-label="New OPDS token (copy it now)"
          className="block w-full rounded-md border border-amber-500/30 bg-zinc-950 px-3 py-2 font-mono text-xs text-amber-100 focus:border-amber-500/60 focus:outline-none focus:ring-1 focus:ring-amber-500/30"
        />
        <button
          onClick={copy}
          aria-label="Copy token"
          title="Copy token"
          className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-amber-500/90 px-3 py-2 text-xs font-medium text-zinc-950 transition-colors hover:bg-amber-400"
        >
          {copied ? <Check size={14} /> : <Copy size={14} />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
    </div>
  );
}

function MintForm({ onMinted }: { onMinted: (m: MintedToken) => void }) {
  const [label, setLabel] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const r = await fetch("/api/opds-tokens", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label }),
      });
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        setError(body.error ?? "Could not create token.");
        return;
      }
      const body = (await r.json()) as MintedToken;
      setLabel("");
      onMinted(body);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={submit}
      className="space-y-3 rounded-lg border border-zinc-900 bg-zinc-950 p-4"
    >
      <h2 className="text-xs uppercase tracking-wider text-zinc-500">
        Mint a token
      </h2>
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex-1 space-y-1">
          <span className="block text-xs text-zinc-500">
            Label (which device or client is this for?)
          </span>
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            autoComplete="off"
            placeholder="android-reader on my phone"
            className="block w-full rounded-md border border-zinc-800 bg-zinc-900/60 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-amber-500/60 focus:outline-none focus:ring-1 focus:ring-amber-500/30"
          />
        </label>
        <button
          type="submit"
          disabled={busy || !label.trim()}
          className="inline-flex items-center gap-1.5 rounded-md bg-amber-500/90 px-4 py-2 text-sm font-medium text-zinc-950 transition-colors hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Plus size={15} />
          Mint
        </button>
      </div>
      {error && <p className="text-sm text-red-400">{error}</p>}
    </form>
  );
}

function TokenRowItem({
  token,
  onRevoked,
}: {
  token: TokenRow;
  onRevoked: () => void;
}) {
  const [busy, setBusy] = useState(false);

  async function revoke() {
    if (
      !confirm(
        `Revoke “${token.label}”? Any client using it stops working immediately.`,
      )
    )
      return;
    setBusy(true);
    try {
      const r = await fetch(`/api/opds-tokens/${token.id}`, {
        method: "DELETE",
      });
      if (!r.ok && r.status !== 204) {
        const b = await r.json().catch(() => ({}));
        alert(b.error ?? "Revoke failed.");
        return;
      }
      onRevoked();
    } finally {
      setBusy(false);
    }
  }

  const created = new Date(token.createdAt).toLocaleDateString();
  const used = token.lastUsedAt
    ? `last used ${new Date(token.lastUsedAt).toLocaleDateString()}`
    : "never used";

  return (
    <li className="flex items-center justify-between gap-3 px-4 py-3">
      <div className="flex min-w-0 items-center gap-3">
        <KeyRound size={15} className="shrink-0 text-zinc-600" />
        <div className="min-w-0">
          <span className="truncate text-sm text-zinc-100">{token.label}</span>
          <p className="text-[11px] text-zinc-600">
            created {created}
            {"  ·  "}
            {used}
          </p>
        </div>
      </div>
      <button
        onClick={revoke}
        disabled={busy}
        title="Revoke token"
        aria-label="Revoke token"
        className="shrink-0 rounded p-1.5 text-zinc-500 transition-colors hover:bg-zinc-900 hover:text-red-400 disabled:opacity-40"
      >
        <Trash2 size={15} />
      </button>
    </li>
  );
}
