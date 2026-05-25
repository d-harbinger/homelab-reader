// Next.js calls register() once on server boot (and on each hot-reload in
// dev). Use it to start the folder watcher so the library populates without
// anyone hitting an endpoint first.
//
// The runtime check excludes Edge — chokidar / yauzl / pdfjs are all
// Node-only.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { startWatcher } = await import("./lib/scanner/watcher");
  const { seedFromBooksPath } = await import("./lib/scanner/locations");

  try {
    // First run with no libraries configured: adopt BOOKS_PATH if it's set.
    await seedFromBooksPath();
    // Watch every enabled library folder (read from the database).
    await startWatcher();
  } catch (err) {
    console.error("[scanner] register() failed", err);
  }
}
