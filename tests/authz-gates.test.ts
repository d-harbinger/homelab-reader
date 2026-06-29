// AUTHZ-01 + AUTHZ-04 — admin/auth gate assertions.
//
// These tests mock ONLY the @/auth seam; the real requireAdmin / authError
// logic runs. Every negative case (signed-out -> 401, reader -> 403)
// short-circuits in the handler's opening try/catch BEFORE any Prisma call, so
// no database is needed here. The scan admin happy-path mocks the scanner
// modules so the call returns fast and we can assert it passed the gate.
//
// Contract under test (verified by reading the route files):
//   - 401 body: { error: "unauthenticated" }
//   - 403 body: { error: "forbidden" }
//   - Next 15 dynamic [id] handlers take { params: Promise<{ id }> }.

import { describe, it, expect, beforeEach, vi } from "vitest";

// Self-contained, hoisted factories (RESEARCH Pitfall 2).
vi.mock("@/auth", () => ({ auth: vi.fn() }));

// Scanner modules mocked so the scan admin happy-path returns immediately
// (no filesystem walk, no real DB). listScanLocations -> [] means the POST's
// for-loop is skipped and it returns a 200 summary.
vi.mock("@/lib/scanner", () => ({
  walkAndScan: vi.fn(async () => ({ scanned: 0, errors: 0 })),
}));
vi.mock("@/lib/scanner/locations", () => ({
  listScanLocations: vi.fn(async () => []),
  enabledLocationPaths: vi.fn(async () => []),
  touchScanLocation: vi.fn(async () => {}),
}));
vi.mock("@/lib/scanner/watcher", () => ({
  markFullScan: vi.fn(() => {}),
  watcherStatus: vi.fn(() => ({ running: false })),
}));

import { signOut, asReader, asAdmin } from "./helpers/auth-mock";

import { POST as scanPost } from "@/app/api/scan/route";
import { GET as usersGet, POST as usersPost } from "@/app/api/users/route";
import {
  PATCH as userPatch,
  DELETE as userDelete,
} from "@/app/api/users/[id]/route";
import {
  GET as locationsGet,
  POST as locationsPost,
} from "@/app/api/locations/route";
import { GET as fsGet } from "@/app/api/fs/route";
import { GET as bookFileGet } from "@/app/api/books/[id]/file/route";
import { GET as coverGet } from "@/app/api/covers/[id]/route";
import { POST as suggestionAccept } from "@/app/api/books/[id]/suggestions/[sid]/route";

// Reset to signed-out before each test so a leaked session can't mask a gate.
beforeEach(() => {
  vi.clearAllMocks();
  signOut();
});

// Helpers to build the call shapes each handler expects.
const jsonReq = (url = "http://test/api", body: unknown = {}) =>
  new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
const idCtx = (id = "any-id") => ({ params: Promise.resolve({ id }) });

async function expect401(res: Response) {
  expect(res.status).toBe(401);
  expect(await res.json()).toEqual({ error: "unauthenticated" });
}
async function expect403(res: Response) {
  expect(res.status).toBe(403);
  expect(await res.json()).toEqual({ error: "forbidden" });
}

// ---------------------------------------------------------------------------
// AUTHZ-01 — POST /api/scan is admin-only.
// ---------------------------------------------------------------------------
describe("POST /api/scan admin gate (AUTHZ-01)", () => {
  it("401 when signed out", async () => {
    await expect401(await scanPost());
  });

  it("403 for a reader", async () => {
    asReader("u-reader");
    await expect403(await scanPost());
  });

  it("admin passes the gate (status is neither 401 nor 403)", async () => {
    asAdmin("u-admin");
    const res = await scanPost();
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
    // With no scan locations seeded the handler returns its 200 ok summary.
    expect(res.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// AUTHZ-04 — every admin route rejects non-admin and unauthenticated callers.
// Each entry asserts both the signed-out (401) and reader (403) branch.
// ---------------------------------------------------------------------------
describe("Admin routes reject non-admin + unauthenticated (AUTHZ-04)", () => {
  const cases: { name: string; call: () => Promise<Response> }[] = [
    { name: "GET /api/users", call: () => usersGet() },
    { name: "POST /api/users", call: () => usersPost(jsonReq("http://test/api/users", { username: "x", password: "y" })) },
    {
      name: "PATCH /api/users/[id]",
      call: () => userPatch(jsonReq("http://test/api/users/any-id", { role: "reader" }), idCtx()),
    },
    {
      name: "DELETE /api/users/[id]",
      call: () =>
        userDelete(new Request("http://test/api/users/any-id", { method: "DELETE" }), idCtx()),
    },
    { name: "GET /api/locations", call: () => locationsGet() },
    { name: "POST /api/locations", call: () => locationsPost(jsonReq("http://test/api/locations", { path: "/x" })) },
    { name: "GET /api/fs", call: () => fsGet(new Request("http://test/api/fs?path=/")) },
    { name: "POST /api/scan", call: () => scanPost() },
    {
      // Accepting a suggestion writes the SHARED Book catalog row, so it is
      // admin-only like the other shared-state mutators — not withUser like the
      // per-user highlights/notes/progress siblings. The reject short-circuits
      // in withAdmin before any Prisma call, so no DB is needed here.
      name: "POST /api/books/[id]/suggestions/[sid]",
      call: () =>
        suggestionAccept(
          jsonReq("http://test/api/books/b/suggestions/s", {}),
          { params: Promise.resolve({ id: "b", sid: "s" }) },
        ),
    },
  ];

  for (const { name, call } of cases) {
    it(`${name} -> 401 when signed out`, async () => {
      signOut();
      await expect401(await call());
    });

    it(`${name} -> 403 for a reader`, async () => {
      asReader("u-reader");
      await expect403(await call());
    });
  }
});

// ---------------------------------------------------------------------------
// AUTHZ — book-file and cover routes are exempt from the cookie-only
// middleware gate (src/auth.config.ts) so they must self-guard in-route via
// authenticateReaderRequest. A signed-out request carrying no OPDS token must
// be rejected with the OPDS 401 challenge (NOT served, and NOT the JSON
// {error} shape — these routes answer with WWW-Authenticate so OPDS clients
// prompt). The no-token reject short-circuits before any Prisma call, so this
// stays DB-free like the rest of this suite. (Token/cookie accept-paths are
// proven against a real DB in tests/reader-auth.test.ts.)
// ---------------------------------------------------------------------------
async function expectChallenge401(res: Response) {
  expect(res.status).toBe(401);
  expect(res.headers.get("WWW-Authenticate")).toBeTruthy();
}

describe("Binary-content routes self-guard (AUTHZ — dual-auth)", () => {
  it("GET /api/books/[id]/file -> 401 challenge when signed out, no token", async () => {
    signOut();
    const res = await bookFileGet(
      new Request("http://test/api/books/any-id/file"),
      idCtx(),
    );
    await expectChallenge401(res);
  });

  it("GET /api/covers/[id] -> 401 challenge when signed out, no token", async () => {
    signOut();
    const res = await coverGet(
      new Request("http://test/api/covers/any-id"),
      idCtx(),
    );
    await expectChallenge401(res);
  });
});
