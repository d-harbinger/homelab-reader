// Next.js calls register() once on server boot (and on each hot-reload in
// dev). Use it to start the folder watcher so the library populates
// without anyone hitting an endpoint first.
//
// The runtime check excludes Edge — chokidar / yauzl / pdfjs are all
// Node-only.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { startWatcher } = await import("./lib/scanner/watcher");
  const booksPath = process.env.BOOKS_PATH || "./books";

  try {
    await startWatcher(booksPath);
  } catch (err) {
    console.error("[scanner] register() failed", err);
  }
}
