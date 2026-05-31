// Minimal in-house promise semaphore — no dependency (deliberately not
// p-limit; the homelab build keeps its dependency surface small).
//
// createLimiter(max) returns an object whose run(fn) executes fn immediately
// when fewer than `max` tasks are in flight, and otherwise queues fn until a
// running task settles. The queue drains FIFO. run() always resolves/rejects
// with fn's own result, so callers keep their existing try/catch.
//
// Used by the scanner watcher to cap how many scanFile/remove dispatches run
// at once: a cold-start bulk import of a large library would otherwise fan out
// one async extract per file simultaneously, spiking memory (each pulls a full
// EPUB/PDF into a buffer). A low cap bounds the burst; hash-first idempotency
// keeps steady-state re-scans cheap regardless.

export interface Limiter {
  run<T>(fn: () => Promise<T>): Promise<T>;
}

export function createLimiter(max: number): Limiter {
  let active = 0;
  const queue: Array<() => void> = [];

  function next(): void {
    active -= 1;
    const resume = queue.shift();
    if (resume) resume();
  }

  return {
    run<T>(fn: () => Promise<T>): Promise<T> {
      return new Promise<T>((resolve, reject) => {
        const start = () => {
          active += 1;
          // Run fn and release the slot once it settles, regardless of
          // outcome, then forward fn's result to the caller.
          fn().then(resolve, reject).finally(next);
        };
        if (active < max) {
          start();
        } else {
          queue.push(start);
        }
      });
    },
  };
}
