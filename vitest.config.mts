import { defineConfig } from "vitest/config";
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
  },
});
