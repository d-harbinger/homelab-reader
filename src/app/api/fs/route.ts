import { NextResponse } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";
import { authError, requireAdmin } from "@/lib/current-user";

// GET /api/fs?path=/some/dir — list the subfolders of a directory so an admin
// can browse the server's filesystem and pick a library folder. Admin-only.
//
// Returns only directories (we're choosing a folder, not a file) plus a count
// of book files directly inside, as a hint. In a container the visible tree is
// whatever's mounted, which is the expected constraint.
export async function GET(req: Request) {
  try {
    await requireAdmin();
  } catch (e) {
    return authError(e);
  }

  const url = new URL(req.url);
  const target = path.resolve(url.searchParams.get("path") || "/");

  let entries;
  try {
    entries = await fs.readdir(target, { withFileTypes: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      { error: `Can't read ${target}: ${msg}` },
      { status: 400 },
    );
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

  const parent = path.dirname(target);
  return NextResponse.json({
    path: target,
    parent: parent === target ? null : parent, // null at filesystem root
    dirs,
    bookCount,
  });
}
