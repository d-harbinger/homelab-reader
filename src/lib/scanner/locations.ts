import fs from "node:fs/promises";
import path from "node:path";
import { prisma } from "@/lib/prisma";

// Library folders are configured in the database (ScanLocation rows), chosen
// by an admin from the server's filesystem — not a single fixed env folder.
// BOOKS_PATH survives only as an optional first-run seed (see seedFromBooksPath).

export interface ScanLocationRow {
  id: string;
  path: string;
  enabled: boolean;
  lastScan: Date | null;
  createdAt: Date;
  bookCount: number;
}

export class LocationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LocationError";
  }
}

async function bookCountUnder(p: string): Promise<number> {
  // Books whose path is inside this folder. SQLite has no path operator, so
  // match on the prefix (the folder plus a separator).
  return prisma.book.count({
    where: { filePath: { startsWith: p.endsWith(path.sep) ? p : p + path.sep } },
  });
}

export async function listScanLocations(): Promise<ScanLocationRow[]> {
  const rows = await prisma.scanLocation.findMany({
    orderBy: { createdAt: "asc" },
  });
  return Promise.all(
    rows.map(async (r) => ({
      id: r.id,
      path: r.path,
      enabled: r.enabled,
      lastScan: r.lastScan,
      createdAt: r.createdAt,
      bookCount: await bookCountUnder(r.path),
    })),
  );
}

export async function enabledLocationPaths(): Promise<string[]> {
  const rows = await prisma.scanLocation.findMany({ where: { enabled: true } });
  return rows.map((r) => r.path);
}

// Validate a candidate folder and add it. Normalizes to an absolute path so
// duplicates and prefix matches are consistent.
export async function addScanLocation(rawPath: string): Promise<ScanLocationRow> {
  const p = path.resolve(rawPath);

  let stat;
  try {
    stat = await fs.stat(p);
  } catch {
    throw new LocationError(`Folder does not exist: ${p}`);
  }
  if (!stat.isDirectory()) {
    throw new LocationError(`Not a folder: ${p}`);
  }

  const existing = await prisma.scanLocation.findUnique({ where: { path: p } });
  if (existing) throw new LocationError("That folder is already a library.");

  const row = await prisma.scanLocation.create({
    data: { path: p, enabled: true },
  });
  return {
    id: row.id,
    path: row.path,
    enabled: row.enabled,
    lastScan: row.lastScan,
    createdAt: row.createdAt,
    bookCount: 0,
  };
}

export async function removeScanLocation(id: string): Promise<string | null> {
  const row = await prisma.scanLocation.findUnique({ where: { id } });
  if (!row) return null;
  await prisma.scanLocation.delete({ where: { id } });
  // Drop the books that lived under this folder so the library doesn't keep
  // ghosts after the source is removed.
  const prefix = row.path.endsWith(path.sep) ? row.path : row.path + path.sep;
  await prisma.book.deleteMany({ where: { filePath: { startsWith: prefix } } });
  return row.path;
}

export async function setScanLocationEnabled(
  id: string,
  enabled: boolean,
): Promise<void> {
  await prisma.scanLocation.update({ where: { id }, data: { enabled } });
}

export async function touchScanLocation(id: string): Promise<void> {
  await prisma.scanLocation.update({
    where: { id },
    data: { lastScan: new Date() },
  });
}

// First-run convenience: if no libraries are configured yet and BOOKS_PATH
// points at a real folder, adopt it as the first ScanLocation. Keeps existing
// Docker/dev setups working without a manual step.
export async function seedFromBooksPath(): Promise<void> {
  const count = await prisma.scanLocation.count();
  if (count > 0) return;

  const booksPath = process.env.BOOKS_PATH;
  if (!booksPath) return;

  const p = path.resolve(booksPath);
  try {
    const stat = await fs.stat(p);
    if (!stat.isDirectory()) return;
  } catch {
    return;
  }
  await prisma.scanLocation.create({ data: { path: p, enabled: true } });
  console.log(`[scanner] seeded first library from BOOKS_PATH: ${p}`);
}
