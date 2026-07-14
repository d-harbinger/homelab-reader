import Link from "next/link";
import {
  ArrowLeft,
  Copy,
  Download,
  FolderTree,
  KeyRound,
  LibraryBig,
  ListChecks,
  ShieldCheck,
  Users,
} from "lucide-react";
import { getCurrentUser } from "@/lib/current-user";

// The settings hub — one front door for everything that used to be a
// pile of header icons and scattered in-page links. Every entry says
// what it is and what it's for BEFORE it's clicked (the same
// explain-then-choose shape as the launchers and the privacy step).
// Role-aware: admin-only surfaces don't render for readers.
export const dynamic = "force-dynamic";

interface Entry {
  href: string;
  title: string;
  desc: string;
  icon: React.ReactNode;
  adminOnly?: boolean;
  download?: boolean;
}

const ENTRIES: Entry[] = [
  {
    href: "/settings/libraries",
    title: "Libraries",
    desc: "The folders scanned for books. Add or remove watched locations.",
    icon: <FolderTree size={16} />,
    adminOnly: true,
  },
  {
    href: "/settings/users",
    title: "Users",
    desc: "Accounts for this reader. Add readers, reset passwords.",
    icon: <Users size={16} />,
    adminOnly: true,
  },
  {
    href: "/settings/tokens",
    title: "OPDS tokens",
    desc: "App passwords for reading apps (android-reader, Librera…) that sync with this server.",
    icon: <KeyRound size={16} />,
  },
  {
    href: "/settings/privacy",
    title: "Privacy",
    desc: "What may talk to the internet (nothing, unless allowed here) — plus the receipt of past lookups.",
    icon: <ShieldCheck size={16} />,
  },
  {
    href: "/settings/genres",
    title: "Folder genres",
    desc: "How the Folders view labels, orders, and hides its folder-derived sections.",
    icon: <ListChecks size={16} />,
    adminOnly: true,
  },
  {
    href: "/sort",
    title: "Sort the Unsorted",
    desc: "Shelve books the classifier couldn't place — by hand, or with online lookups if enabled.",
    icon: <LibraryBig size={16} />,
    adminOnly: true,
  },
  {
    href: "/duplicates",
    title: "Duplicates report",
    desc: "Copies of the same book found in the library, so the extras can be cleaned up.",
    icon: <Copy size={16} />,
  },
  {
    href: "/api/library/organize-plan",
    title: "Organize script",
    desc: "Downloads a reviewable script that moves files into folders matching their shelves. Run it on the server, then rescan — notes and progress survive the moves.",
    icon: <Download size={16} />,
    adminOnly: true,
    download: true,
  },
];

export default async function SettingsPage() {
  const me = await getCurrentUser();
  const isAdmin = me?.role === "admin";
  const entries = ENTRIES.filter((e) => isAdmin || !e.adminOnly);

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
        <h1 className="text-lg font-semibold text-zinc-100">Settings</h1>
      </div>

      <ul className="divide-y divide-zinc-900 rounded-md border border-zinc-800">
        {entries.map((e) => (
          <li key={e.href}>
            <Link
              href={e.href}
              {...(e.download ? { prefetch: false } : {})}
              className="flex items-start gap-3 p-4 transition-colors hover:bg-zinc-900/60"
            >
              <span className="mt-0.5 flex h-8 w-8 flex-none items-center justify-center rounded-md bg-zinc-900 text-zinc-400 ring-1 ring-inset ring-zinc-800">
                {e.icon}
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-medium text-zinc-200">{e.title}</span>
                <span className="block text-xs leading-relaxed text-zinc-500">{e.desc}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
