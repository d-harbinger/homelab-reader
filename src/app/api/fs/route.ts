import { NextResponse } from "next/server";
import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { withAdmin } from "@/lib/route-helpers";

// GET /api/fs?path=/some/dir — list the subfolders of a directory so an admin
// can browse the server's filesystem and pick a library folder. Admin-only.
//
// Browsing is jailed to a single root. Without a jail, the dev fallback to the
// home directory would let a crafted `path` walk the whole server filesystem,
// and echoing the OS error on failure leaks an existence oracle (telling
// "forbidden" apart from "missing"). Both are closed here:
//   - every request is confined to the browse root,
//   - out-of-jail / missing / unreadable all return one opaque 400.
//
// Returns only directories (we're choosing a folder, not a file) plus a count
// of book files directly inside, as a hint.

// Where browsing is allowed to start. Resolved per request (cheap, testable):
//   1. FS_BROWSE_ROOT if set        — explicit operator override
//   2. /app/books if it exists      — the container's read-only library mount
//   3. os.homedir()                 — dev fallback so the picker can reach the
//                                     user's library folder
function browseRoot(): string {
  const configured = process.env.FS_BROWSE_ROOT;
  if (configured) return path.resolve(configured);
  if (existsSync("/app/books")) return "/app/books";
  return os.homedir();
}

// Uniform failure: no path echo, no errno, no distinction between forbidden,
// missing, and unreadable. One body for every read that can't be served.
const denied = () =>
  NextResponse.json({ error: "Can't read that directory" }, { status: 400 });

export const GET = withAdmin(async (_admin, req) => {
  const root = browseRoot();
  const url = new URL(req.url);
  const requested = url.searchParams.get("path");
  // No path param defaults to the jail ROOT, never "/".
  const target = requested ? path.resolve(requested) : root;

  // Jail check: target must be the root or sit beneath it. relative() yields a
  // "../" prefix or an absolute path exactly when target escapes the root.
  const rel = path.relative(root, target);
  if (rel.startsWith("..") || path.isAbsolute(rel)) return denied();

  let entries;
  try {
    entries = await fs.readdir(target, { withFileTypes: true });
  } catch {
    return denied();
  }

  const dirs: { name: string; path: string }[] = [];
  let bookCount = 0;
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue; // hide dotfiles/dirs
    if (entry.isDirectory()) {
      dirs.push({ name: entry.name, path: path.join(target, entry.name) });
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();
      if (ext === ".epub" || ext === ".pdf") bookCount++;
    }
  }
  dirs.sort((a, b) => a.name.localeCompare(b.name));

  // parent never points above the jail root; null when target IS the root.
  const parent = target === root ? null : path.dirname(target);
  return NextResponse.json({
    path: target,
    parent,
    dirs,
    bookCount,
  });
});
