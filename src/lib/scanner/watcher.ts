import chokidar, { type FSWatcher } from "chokidar";
import fs from "node:fs/promises";
import path from "node:path";
import {
  type BookFormat,
  isBookFile,
  removeFileFromLibrary,
  scanFile,
} from "./index";
import { enabledLocationPaths } from "./locations";
import { createLimiter } from "@/lib/concurrency";
import { clearFailedImport, recordFailedImport } from "./failed-imports";

// Derive the book format from the file extension at the watcher boundary
// (epub/pdf) for the FailedImport record — there's no Book row to read it from
// when extraction has just failed. isBookFile already gated the handler, so the
// extension is one of the two.
function formatFromExtension(filePath: string): BookFormat {
  return path.extname(filePath).toLowerCase() === ".pdf" ? "pdf" : "epub";
}

// Cap how many file events are processed concurrently. A cold-start scan of a
// large library fires one chokidar "add" per file; without a cap each would
// pull a full EPUB/PDF into memory at once. Cap 4 keeps the burst bounded
// while still overlapping I/O-bound extracts. State is module-level (shared
// across all handlers) so the cap is global, not per-handler.
const limiter = createLimiter(4);

// How long the initial walk must have been quiet before the reconcile-delete
// sweep may run. Generously above awaitWriteFinish's stabilityThreshold
// (1500ms) plus its poll interval, because the sweep's mistake is
// irreversible: deleting a Book row cascades its notes, highlights and ink.
const RECONCILE_SETTLE_MS = 4000;

// chokidar fires "ready" when the initial directory walk has been ENUMERATED,
// not when the add handlers it queued have finished — and awaitWriteFinish can
// hold individual add events back until after "ready". Running the
// reconcile-delete sweep in that window is how a mount-point move destroyed a
// library's annotations (2026-08-06): the sweep saw every old path as missing
// before the hash re-link scans could repoint the rows to the new paths, and
// the delete cascade took the notes, highlights and ink with them. A book's
// identity follows its content; the sweep must not run until the scans that
// enforce that have settled.
export class ScanTracker {
  private pending = new Set<Promise<unknown>>();
  private lastQueuedAt = 0;

  track<T>(p: Promise<T>): Promise<T> {
    this.lastQueuedAt = Date.now();
    this.pending.add(p);
    const drop = () => this.pending.delete(p);
    p.then(drop, drop);
    return p;
  }

  /** Resolves once nothing is in flight and nothing new arrived for settleMs. */
  async settle(settleMs: number): Promise<void> {
    for (;;) {
      await Promise.allSettled([...this.pending]);
      const quietFor = Date.now() - this.lastQueuedAt;
      if (this.pending.size === 0 && quietFor >= settleMs) return;
      await new Promise((r) => setTimeout(r, Math.max(50, settleMs - quietFor)));
    }
  }
}

// Reconcile DB against disk: any Book row whose file doesn't exist anymore
// (deleted while the watcher was offline) gets removed, so the library shows
// no ghost rows from the last run. Deliberately a standalone function: the
// caller decides when it is SAFE to run (see ScanTracker), and the sweep is
// testable without chokidar. Returns how many rows were removed.
export async function reconcileMissingBooks(): Promise<number> {
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
  // Refuse the delete-everything case: a library where EVERY book is missing
  // is an unmounted, renamed or empty mount, not a deliberate deletion of the
  // whole collection — and rows deleted here cascade their annotations away.
  // Ghost rows until the next healthy boot are the cheap side of that trade.
  if (missingBooks.length > 0 && missingBooks.length === rows.length) {
    console.error(
      `[scanner] reconcile refused: all ${rows.length} book(s) are missing from disk — ` +
        "this looks like an unmounted or empty library, not a deletion. No rows removed; " +
        "fix the books mount and restart.",
    );
    return 0;
  }
  if (missingBooks.length > 0) {
    await prisma.book.deleteMany({ where: { id: { in: missingBooks } } });
    console.log(`[scanner] reconciled — removed ${missingBooks.length} missing book(s)`);
  }
  return missingBooks.length;
}

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

  // Per-watcher tracker: the reconcile sweep below waits on the scans this
  // watcher instance queued, and a restart gets a fresh one.
  const tracker = new ScanTracker();

  const w = chokidar.watch(ok, {
    persistent: true,
    ignoreInitial: false,
    // Wait until writes settle — important for large EPUB/PDF copies that
    // arrive in chunks. Otherwise we hash a partial file.
    awaitWriteFinish: { stabilityThreshold: 1500, pollInterval: 200 },
    // Don't follow symlinks out of the library root by default.
    followSymlinks: false,
  });

  w.on("add", (filePath: string) => {
    if (!isBookFile(filePath)) return;
    // Tracked so the reconcile sweep can wait for the initial walk's scans —
    // the hash re-link that keeps annotations on a moved file happens inside
    // scanFile, and the sweep must never outrun it.
    void tracker.track(
      (async () => {
        try {
          await limiter.run(() => scanFile(filePath));
          // Succeeded — drop any prior failure record for this path so a fixed
          // book stops being reported.
          await clearFailedImport(filePath);
        } catch (err) {
          console.error(`[scanner] add failed: ${filePath}`, err);
          // Extraction threw — record a visible FailedImport instead of letting
          // the book silently vanish.
          await recordFailedImport(filePath, formatFromExtension(filePath), err).catch(
            (recErr) =>
              console.error(`[scanner] recordFailedImport failed: ${filePath}`, recErr),
          );
        }
      })(),
    );
  });

  w.on("change", async (filePath: string) => {
    if (!isBookFile(filePath)) return;
    try {
      await limiter.run(() => scanFile(filePath));
      await clearFailedImport(filePath);
    } catch (err) {
      console.error(`[scanner] change failed: ${filePath}`, err);
      await recordFailedImport(filePath, formatFromExtension(filePath), err).catch(
        (recErr) =>
          console.error(`[scanner] recordFailedImport failed: ${filePath}`, recErr),
      );
    }
  });

  w.on("unlink", async (filePath: string) => {
    if (!isBookFile(filePath)) return;
    try {
      await limiter.run(() => removeFileFromLibrary(filePath));
      // The file is gone — any failure record for it is stale.
      await clearFailedImport(filePath);
    } catch (err) {
      console.error(`[scanner] unlink failed: ${filePath}`, err);
    }
  });

  w.on("ready", async () => {
    // Wait out the initial walk before reconciling (see ScanTracker), and
    // abort if this watcher was torn down while waiting — the restart's own
    // ready handler runs its own sweep.
    await tracker.settle(RECONCILE_SETTLE_MS);
    if (state().watcher !== w) return;
    try {
      await reconcileMissingBooks();
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
