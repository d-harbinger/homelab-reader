import chokidar, { type FSWatcher } from "chokidar";
import fs from "node:fs/promises";
import { isBookFile, removeFileFromLibrary, scanFile } from "./index";
import { enabledLocationPaths } from "./locations";

// State lives on globalThis so it survives Next's instrumentation-vs-
// request-handler module split (the same gotcha that forces the Prisma
// singleton pattern). Without this, /api/scan/status reports
// running:false because it imports a separate module instance from the
// one instrumentation.ts started.
interface WatcherState {
  watcher: FSWatcher | null;
  watchedPaths: string[];
  lastBootError: Error | null;
  lastFullScanAt: Date | null;
}

const globalForWatcher = globalThis as unknown as {
  __homelabReaderWatcher: WatcherState | undefined;
};

function state(): WatcherState {
  if (!globalForWatcher.__homelabReaderWatcher) {
    globalForWatcher.__homelabReaderWatcher = {
      watcher: null,
      watchedPaths: [],
      lastBootError: null,
      lastFullScanAt: null,
    };
  }
  return globalForWatcher.__homelabReaderWatcher;
}

interface WatcherStatus {
  running: boolean;
  watchedPaths: string[];
  lastError: string | null;
  lastFullScanAt: Date | null;
}

export function watcherStatus(): WatcherStatus {
  const s = state();
  return {
    running: s.watcher !== null,
    watchedPaths: s.watchedPaths,
    lastError: s.lastBootError?.message ?? null,
    lastFullScanAt: s.lastFullScanAt,
  };
}

// Keep only paths that currently exist as directories, so one missing folder
// (unmounted volume, deleted source) doesn't stop the watcher for the rest.
async function existingDirs(paths: string[]): Promise<{
  ok: string[];
  missing: string[];
}> {
  const ok: string[] = [];
  const missing: string[] = [];
  for (const p of paths) {
    try {
      const stat = await fs.stat(p);
      if (stat.isDirectory()) ok.push(p);
      else missing.push(p);
    } catch {
      missing.push(p);
    }
  }
  return { ok, missing };
}

// Start watching every enabled library folder. Reads the folder set from the
// database (ScanLocation rows). Safe to call when none are configured yet.
export async function startWatcher(): Promise<void> {
  const s = state();
  if (s.watcher) return;

  const configured = await enabledLocationPaths();
  if (configured.length === 0) {
    s.watchedPaths = [];
    s.lastBootError = null;
    console.log("[scanner] no libraries configured yet");
    return;
  }

  const { ok, missing } = await existingDirs(configured);
  s.lastBootError =
    missing.length > 0
      ? new Error(`Some library folders are unavailable: ${missing.join(", ")}`)
      : null;
  if (missing.length > 0) console.warn(`[scanner] ${s.lastBootError?.message}`);

  if (ok.length === 0) {
    s.watchedPaths = [];
    return;
  }

  console.log(`[scanner] watching ${ok.length} folder(s): ${ok.join(", ")}`);
  s.watchedPaths = ok;

  const w = chokidar.watch(ok, {
    persistent: true,
    ignoreInitial: false,
    // Wait until writes settle — important for large EPUB/PDF copies that
    // arrive in chunks. Otherwise we hash a partial file.
    awaitWriteFinish: { stabilityThreshold: 1500, pollInterval: 200 },
    // Don't follow symlinks out of the library root by default.
    followSymlinks: false,
  });

  w.on("add", async (filePath: string) => {
    if (!isBookFile(filePath)) return;
    try {
      await scanFile(filePath);
    } catch (err) {
      console.error(`[scanner] add failed: ${filePath}`, err);
    }
  });

  w.on("change", async (filePath: string) => {
    if (!isBookFile(filePath)) return;
    try {
      await scanFile(filePath);
    } catch (err) {
      console.error(`[scanner] change failed: ${filePath}`, err);
    }
  });

  w.on("unlink", async (filePath: string) => {
    if (!isBookFile(filePath)) return;
    try {
      await removeFileFromLibrary(filePath);
    } catch (err) {
      console.error(`[scanner] unlink failed: ${filePath}`, err);
    }
  });

  w.on("ready", async () => {
    // Reconcile DB against disk: any Book row whose file doesn't exist
    // anymore (deleted while the watcher was offline) gets removed. Without
    // this, the library shows ghost rows from the last run.
    try {
      const { prisma } = await import("@/lib/prisma");
      const rows = await prisma.book.findMany({ select: { id: true, filePath: true } });
      const missingBooks: string[] = [];
      for (const r of rows) {
        try {
          await fs.access(r.filePath);
        } catch {
          missingBooks.push(r.id);
        }
      }
      if (missingBooks.length > 0) {
        await prisma.book.deleteMany({ where: { id: { in: missingBooks } } });
        console.log(`[scanner] reconciled — removed ${missingBooks.length} missing book(s)`);
      }
    } catch (err) {
      console.error("[scanner] reconcile failed", err);
    }
    state().lastFullScanAt = new Date();
    console.log(`[scanner] initial scan complete`);
  });

  w.on("error", (err: unknown) => {
    console.error("[scanner] watcher error", err);
  });

  s.watcher = w;
}

export async function stopWatcher(): Promise<void> {
  const s = state();
  if (!s.watcher) return;
  await s.watcher.close();
  s.watcher = null;
  s.watchedPaths = [];
}

// Apply a change to the configured library set (add / remove / enable-toggle):
// tear the watcher down and bring it back up against the new folder list.
export async function restartWatcher(): Promise<void> {
  await stopWatcher();
  await startWatcher();
}

export function markFullScan() {
  state().lastFullScanAt = new Date();
}
