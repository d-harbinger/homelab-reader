import chokidar, { type FSWatcher } from "chokidar";
import fs from "node:fs/promises";
import { isBookFile, removeFileFromLibrary, scanFile } from "./index";

// State lives on globalThis so it survives Next's instrumentation-vs-
// request-handler module split (the same gotcha that forces the Prisma
// singleton pattern). Without this, /api/scan/status reports
// running:false because it imports a separate module instance from the
// one instrumentation.ts started.
interface WatcherState {
  watcher: FSWatcher | null;
  watchedPath: string | null;
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
      watchedPath: null,
      lastBootError: null,
      lastFullScanAt: null,
    };
  }
  return globalForWatcher.__homelabReaderWatcher;
}

interface WatcherStatus {
  running: boolean;
  watchedPath: string | null;
  lastError: string | null;
  lastFullScanAt: Date | null;
}

export function watcherStatus(): WatcherStatus {
  const s = state();
  return {
    running: s.watcher !== null,
    watchedPath: s.watchedPath,
    lastError: s.lastBootError?.message ?? null,
    lastFullScanAt: s.lastFullScanAt,
  };
}

export async function startWatcher(booksPath: string): Promise<void> {
  const s = state();
  if (s.watcher) return;

  // Don't blow up the server if BOOKS_PATH points at nothing yet (fresh
  // install, dogfood volume not mounted, etc). Log and exit; the manual
  // /api/scan POST can be retried once the path exists.
  try {
    const stat = await fs.stat(booksPath);
    if (!stat.isDirectory()) {
      s.lastBootError = new Error(`BOOKS_PATH ${booksPath} is not a directory`);
      console.warn(`[scanner] ${s.lastBootError.message}`);
      return;
    }
  } catch {
    s.lastBootError = new Error(`BOOKS_PATH ${booksPath} does not exist`);
    console.warn(`[scanner] ${s.lastBootError.message}`);
    return;
  }

  console.log(`[scanner] watching ${booksPath}`);
  s.lastBootError = null;
  s.watchedPath = booksPath;

  const w = chokidar.watch(booksPath, {
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

  w.on("ready", () => {
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
  s.watchedPath = null;
}

export function markFullScan() {
  state().lastFullScanAt = new Date();
}
