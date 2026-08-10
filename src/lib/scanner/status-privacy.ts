import type { WatcherStatus } from "@/lib/scanner/watcher";

// The watcher's status object carries `watchedPaths` — the absolute library
// roots as the server sees them. On a homelab those are home-directory paths,
// which name the operator's account and their directory layout, and the status
// endpoints are polled by every signed-in browser on the home screen.
//
// An admin configures those paths in Settings and already sees them there, so
// nothing is hidden from the person who set them. Everyone else gets the shape
// of the answer — is the watcher up, how many roots, when was the last full
// scan — without the paths themselves.
//
// `lastError` goes the same way: a watcher boot failure is an OS error string,
// and those routinely quote the path that failed.
//
// `watchedCount` is present for BOTH roles rather than only for the redacted
// one. The home screen only ever asks how many folders are being watched (it
// renders "3 folders" and branches on zero), so serving the count to everyone
// lets the client stop reading the array at all — the paths are then admin-only
// data that no rendering path depends on, which is what keeps this from
// regressing the next time someone adds a status field.
export interface PublicWatcherStatus {
  running: boolean;
  watchedCount: number;
  watchedPaths?: string[];
  lastFullScanAt: WatcherStatus["lastFullScanAt"];
  lastError: string | null;
}

export function redactWatcherStatus(
  status: WatcherStatus,
  isAdmin: boolean,
): PublicWatcherStatus {
  const base: PublicWatcherStatus = {
    running: status.running,
    watchedCount: status.watchedPaths.length,
    lastFullScanAt: status.lastFullScanAt,
    lastError: status.lastError ? "watcher error" : null,
  };
  if (!isAdmin) return base;
  return { ...base, watchedPaths: status.watchedPaths, lastError: status.lastError };
}
