import os from "node:os";
import path from "node:path";
import { defineConfig, devices } from "@playwright/test";

// End-to-end config for the core-flow suite (e2e/). This is the served-surface
// complement to the vitest unit suite: it boots a real Next.js server against an
// isolated SQLite database and drives the browser through the whole journey.
//
// The suite runs entirely on the local loopback interface. The pinned Chromium
// (matching the version already cached for this Playwright release) is launched
// headless; no browser download is required.

const PORT = 3100;
const BASE_URL = `http://localhost:${PORT}`;

// Isolated database, kept OUTSIDE the repository tree on purpose. Next's dev
// server watches the project root for changes; a SQLite database inside it
// (its write-ahead-log churns on every write) triggers a Fast Refresh recompile
// storm that remounts pages mid-interaction. Putting the database under the OS
// temp dir keeps it off the watcher entirely. `e2e` in the path is also the
// guard token reset-db.mjs checks before it will delete anything.
const E2E_DB = path.join(os.tmpdir(), "homelab-reader-e2e", "e2e.db");
const DATABASE_URL = `file:${E2E_DB}?connection_limit=1`;

export default defineConfig({
  testDir: "./e2e",
  // Artifacts (failure screenshots, traces) land OUTSIDE the repo. Playwright
  // writes trace data live throughout a test; if that lands inside the project,
  // Next's dev-server watcher sees the churn and Fast-Refresh-remounts the page
  // mid-interaction. Keeping them under the OS temp dir avoids that entirely and
  // keeps run artifacts out of version control (never committed).
  outputDir: path.join(os.tmpdir(), "homelab-reader-e2e", "artifacts"),
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: [["list"]],
  timeout: 60_000,
  expect: { timeout: 15_000 },

  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    // Loopback-only origin, no real TLS.
    ignoreHTTPSErrors: true,
    // The dev server compiles routes on demand, so the first navigation to a
    // heavy reader page (epub.js / PDF.js) can take a while cold.
    navigationTimeout: 90_000,
    actionTimeout: 20_000,
  },

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],

  // Boot sequence: wipe the isolated DB, apply migrations, seed fixtures, copy
  // the PDF.js worker into /public, then start the dev server. Each step
  // inherits the env below, so every process agrees on the same database.
  webServer: {
    // --turbopack matches the project's own `npm run dev`: the webpack dev
    // bundler hits a module-interop bug (`__webpack_require__.n is not a
    // function`) on the client pages here, which Turbopack does not.
    command:
      "node e2e/reset-db.mjs && npx prisma migrate deploy && node e2e/seed.mjs && node scripts/copy-pdfjs-worker.mjs && npx next dev --turbopack -p 3100",
    url: BASE_URL,
    reuseExistingServer: false,
    timeout: 180_000,
    stdout: "pipe",
    stderr: "pipe",
    env: {
      DATABASE_URL,
      AUTH_SECRET: "e2e-fixed-test-secret-not-used-in-production",
      AUTH_TRUST_HOST: "true",
      NEXTAUTH_URL: BASE_URL,
      NEXT_TELEMETRY_DISABLED: "1",
    },
  },
});
