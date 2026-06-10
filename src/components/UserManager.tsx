"use client";

import { useState, type FormEvent } from "react";
import useSWR from "swr";
import { KeyRound, Shield, ShieldOff, Trash2, UserPlus } from "lucide-react";
import { fetcher } from "@/lib/fetcher";

interface ManagedUser {
  id: string;
  username: string;
  role: string;
  createdAt: string;
}

export function UserManager({ currentUserId }: { currentUserId: string }) {
  const { data, mutate, isLoading } = useSWR<{ users: ManagedUser[] }>(
    "/api/users",
    fetcher,
  );
  const users = data?.users ?? [];

  return (
    <div className="space-y-8">
      <AddUserForm onCreated={() => mutate()} />

      <div className="space-y-2">
        <h2 className="text-xs uppercase tracking-wider text-zinc-500">
          Accounts {users.length > 0 && <span className="text-zinc-700">{users.length}</span>}
        </h2>
        {isLoading ? (
          <p className="text-sm text-zinc-600">Loading…</p>
        ) : (
          <ul className="divide-y divide-zinc-900 rounded-lg border border-zinc-900">
            {users.map((u) => (
              <UserRow
                key={u.id}
                user={u}
                isSelf={u.id === currentUserId}
                onChanged={() => mutate()}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function AddUserForm({ onCreated }: { onCreated: () => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"reader" | "admin">("reader");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const r = await fetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password, role }),
      });
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        setError(body.error ?? "Could not create user.");
        return;
      }
      setUsername("");
      setPassword("");
      setRole("reader");
      onCreated();
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
        Add a user
      </h2>
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex-1 space-y-1">
          <span className="block text-xs text-zinc-500">Username</span>
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="off"
            className="block w-full rounded-md border border-zinc-800 bg-zinc-900/60 px-3 py-2 text-sm text-zinc-100 focus:border-amber-500/60 focus:outline-none focus:ring-1 focus:ring-amber-500/30"
          />
        </label>
        <label className="flex-1 space-y-1">
          <span className="block text-xs text-zinc-500">Password</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
            className="block w-full rounded-md border border-zinc-800 bg-zinc-900/60 px-3 py-2 text-sm text-zinc-100 focus:border-amber-500/60 focus:outline-none focus:ring-1 focus:ring-amber-500/30"
          />
        </label>
        <label className="space-y-1">
          <span className="block text-xs text-zinc-500">Role</span>
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as "reader" | "admin")}
            className="rounded-md border border-zinc-800 bg-zinc-900/60 px-3 py-2 text-sm text-zinc-100 focus:border-amber-500/60 focus:outline-none focus:ring-1 focus:ring-amber-500/30"
          >
            <option value="reader">Reader</option>
            <option value="admin">Admin</option>
          </select>
        </label>
        <button
          type="submit"
          disabled={busy || !username || !password}
          className="inline-flex items-center gap-1.5 rounded-md bg-amber-500/90 px-4 py-2 text-sm font-medium text-zinc-950 transition-colors hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <UserPlus size={15} />
          Add
        </button>
      </div>
      {error && <p className="text-sm text-red-400">{error}</p>}
    </form>
  );
}

function UserRow({
  user,
  isSelf,
  onChanged,
}: {
  user: ManagedUser;
  isSelf: boolean;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);

  async function patch(body: Record<string, unknown>) {
    setBusy(true);
    try {
      const r = await fetch(`/api/users/${user.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!r.ok) {
        const b = await r.json().catch(() => ({}));
        alert(b.error ?? "Update failed.");
        return;
      }
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  async function resetPassword() {
    const pw = prompt(`New password for ${user.username}:`);
    if (pw == null) return;
    await patch({ password: pw });
  }

  async function toggleRole() {
    await patch({ role: user.role === "admin" ? "reader" : "admin" });
  }

  async function remove() {
    if (!confirm(`Delete ${user.username}? Their notes and progress go too.`))
      return;
    setBusy(true);
    try {
      const r = await fetch(`/api/users/${user.id}`, { method: "DELETE" });
      if (!r.ok && r.status !== 204) {
        const b = await r.json().catch(() => ({}));
        alert(b.error ?? "Delete failed.");
        return;
      }
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="flex items-center justify-between gap-3 px-4 py-3">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm text-zinc-100">{user.username}</span>
          {user.role === "admin" && (
            <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-300">
              admin
            </span>
          )}
          {isSelf && <span className="text-[10px] text-zinc-600">you</span>}
        </div>
      </div>
      <div className="flex items-center gap-1">
        <button
          onClick={resetPassword}
          disabled={busy}
          title="Reset password"
          aria-label="Reset password"
          className="rounded p-1.5 text-zinc-500 transition-colors hover:bg-zinc-900 hover:text-zinc-200 disabled:opacity-40"
        >
          <KeyRound size={15} />
        </button>
        <button
          onClick={toggleRole}
          disabled={busy || isSelf}
          title={isSelf ? "Can't change your own role" : user.role === "admin" ? "Demote to reader" : "Promote to admin"}
          aria-label="Toggle role"
          className="rounded p-1.5 text-zinc-500 transition-colors hover:bg-zinc-900 hover:text-zinc-200 disabled:opacity-30"
        >
          {user.role === "admin" ? <ShieldOff size={15} /> : <Shield size={15} />}
        </button>
        <button
          onClick={remove}
          disabled={busy || isSelf}
          title={isSelf ? "Can't delete yourself" : "Delete user"}
          aria-label="Delete user"
          className="rounded p-1.5 text-zinc-500 transition-colors hover:bg-zinc-900 hover:text-red-400 disabled:opacity-30"
        >
          <Trash2 size={15} />
        </button>
      </div>
    </li>
  );
}
