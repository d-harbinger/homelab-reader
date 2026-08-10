import { defineConfig, configDefaults } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

// Node-environment Vitest config for route-handler + library tests.
//
// - environment: "node" — these are App Router route handlers and lib
//   functions, not React components. No jsdom, no @vitejs/plugin-react
//   (research Pitfall 3: the official Next.js guide defaults to jsdom for
//   component tests; that is wrong here).
// - tsconfigPaths() resolves the "@/*" -> "./src/*" alias declared in
//   tsconfig.json so test imports like `import { auth } from "@/auth"` work.
// - globals: false — tests import { describe, it, expect, vi } from "vitest"
//   explicitly, matching the repo's strict no-implicit-globals style.
// - setupFiles runs ./tests/setup.ts before each test file; it documents the
//   Prisma-singleton DATABASE_URL seam (see tests/setup.ts).
export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: "node",
    globals: false,
    setupFiles: ["./tests/setup.ts"],
    // Most suites here build a throwaway database in beforeAll, which shells
    // out to `prisma migrate deploy` — around seven seconds on an idle machine
    // and longer while fifty-odd other files compete for it. Vitest allows ten
    // seconds by default, so a busy run could fail a file before a single test
    // in it executed, and the failure would look like the feature under test
    // rather than the clock. Raised here rather than file by file: the timeout
    // belongs to how these suites get their database, which is shared, and
    // thirty files each carrying their own copy of the number is how the two
    // drift apart. This buys no time for a genuinely hung test — an assertion
    // still fails on its own timeout.
    hookTimeout: 60_000,
    // The end-to-end suite (e2e/) runs under Playwright, whose `test` export is
    // incompatible with Vitest's runner. Keep Vitest to the unit/route tests.
    exclude: [...configDefaults.exclude, "e2e/**"],
  },
});
