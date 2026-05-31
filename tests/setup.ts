// Vitest global setup (registered as setupFiles in vitest.config.mts).
//
// =====================================================================
// Prisma-singleton seam — THE structural risk in this phase (RESEARCH
// Pitfall 1 / Assumption A3).
// =====================================================================
//
// src/lib/prisma.ts constructs `new PrismaClient()` at IMPORT TIME, reading
// DATABASE_URL from the environment then, and memoizes the instance on
// globalThis. Two consequences for tests:
//
//   1. The first module that imports `@/lib/prisma` freezes the connection
//      URL for the whole process. Setting DATABASE_URL *after* that import
//      (strategy a) is therefore fragile — it depends on import ordering
//      that Vitest's per-file module graph does not guarantee.
//
//   2. If nothing redirects it, that frozen client points at the PRODUCTION
//      SQLite file (./data/homelab-reader.db) — an isolation test could read
//      or mutate real data.
//
// CHOSEN STRATEGY: (b) per-test `vi.mock("@/lib/prisma")`.
// -----------------------------------------------------------------------
// The isolation suite (tests/isolation.test.ts) creates an ephemeral
// PrismaClient via makeTestDb() and injects it with:
//
//     vi.mock("@/lib/prisma", () => ({ prisma: db.prisma }));
//
// This is guaranteed to bind the route handlers' `prisma` import to the
// temp-file client regardless of import ordering, because vi.mock is hoisted
// above the route imports and fully replaces the singleton module. This is
// the robust path RESEARCH recommends when setupFiles ordering is unreliable.
//
// FALLBACK STRATEGY (a), kept documented for the host run: instead of mocking
// the module, set a fresh temp DATABASE_URL here BEFORE any `@/lib/prisma`
// import and let the real singleton pick it up. If, on the host, the vi.mock
// approach ever proves awkward (e.g. a transitive import loads the singleton
// before the mock applies), switch the isolation suite to strategy (a) by
// exporting the temp URL from makeTestDb and assigning process.env.DATABASE_URL
// in this file before the first import. Both are valid; (b) is the default.
//
// This file also sets a harmless placeholder DATABASE_URL so that the pure
// auth-gate suite (tests/authz-gates.test.ts) — which imports route modules
// that transitively import @/lib/prisma but never actually run a query (the
// 401/403 cases short-circuit first) — never instantiates a client against a
// real path. It is a sqlite file URL inside the OS temp dir, never touched.

import { tmpdir } from "node:os";
import path from "node:path";

if (!process.env.DATABASE_URL) {
  // Placeholder only — the gate suite never queries this; the isolation
  // suite overrides the prisma module entirely (strategy b above).
  process.env.DATABASE_URL = `file:${path.join(tmpdir(), "hlr-vitest-placeholder.db")}`;
}

// NextAuth is fully mocked at the @/auth seam in the specs, so AUTH_SECRET is
// never read. Set a dummy anyway in case a transitive import asserts on it.
if (!process.env.AUTH_SECRET) {
  process.env.AUTH_SECRET = "test-secret-not-used-auth-is-mocked";
}
