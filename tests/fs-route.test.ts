// FS-JAIL — GET /api/fs is the admin filesystem picker. It must stay inside a
// configured browse root ("jail") and leak nothing on failure.
//
// Threat model this locks down:
//   - Home-directory enumeration: in dev the jail falls back to os.homedir(),
//     so the picker can reach the library folder — but a crafted `path` must
//     NOT walk out of that root to read arbitrary server directories.
//   - Existence oracle: the old route echoed the target path AND the raw errno
//     message, so a caller could tell EACCES (exists, forbidden) from ENOENT
//     (absent). Out-of-jail / missing / unreadable must be INDISTINGUISHABLE:
//     identical 400 { error: "Can't read that directory" }, no path, no errno.
//
// Branch enumeration:
//   - in-jail listing works (tmpdir set as FS_BROWSE_ROOT via env stub)
//   - no `path` param -> defaults to the jail ROOT (not "/")
//   - ".." escape -> uniform 400
//   - absolute out-of-jail path -> uniform 400
//   - nonexistent in-jail dir vs permission-denied -> SAME status + body
//   - parent is null when the target IS the jail root
//   - dotfiles/dirs hidden; dirs + bookCount shape unchanged
//   - non-admin -> 403 (withAdmin pins this; asserted for this route too)
//
// Seam: same auth boundary as route-helpers.test.ts — auth() from "@/auth"
// mocked so the real requireAdmin logic runs. FS_BROWSE_ROOT is stubbed per
// test with vi.stubEnv so the jail root is a throwaway tmpdir we control.

import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
  vi,
} from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

vi.mock("@/auth", () => ({ auth: vi.fn() }));

import { asAdmin, asReader, signOut } from "./helpers/auth-mock";
import { GET } from "@/app/api/fs/route";

// A throwaway jail root with a known shape, created once for the suite:
//   <root>/alpha/        (dir)
//   <root>/beta/         (dir)
//   <root>/.hidden/      (dotdir, must be hidden)
//   <root>/book.epub     (file -> counts toward bookCount)
//   <root>/notes.txt     (file -> ignored)
//   <root>/.secret       (dotfile, must be hidden)
let root: string;

const req = (rawPath?: string) => {
  const u = new URL("http://test/api/fs");
  if (rawPath !== undefined) u.searchParams.set("path", rawPath);
  return new Request(u);
};

beforeAll(() => {
  root = mkdtempSync(path.join(tmpdir(), "hlr-fsjail-"));
  mkdirSync(path.join(root, "alpha"));
  mkdirSync(path.join(root, "beta"));
  mkdirSync(path.join(root, ".hidden"));
  writeFileSync(path.join(root, "book.epub"), "x");
  writeFileSync(path.join(root, "notes.txt"), "x");
  writeFileSync(path.join(root, ".secret"), "x");
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

beforeEach(() => {
  vi.clearAllMocks();
  signOut();
  vi.stubEnv("FS_BROWSE_ROOT", root);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("GET /api/fs — jail enforcement", () => {
  it("lists subfolders inside the jail and counts book files", async () => {
    asAdmin("a-1");
    const res = await GET(req(root));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.dirs.map((d: { name: string }) => d.name)).toEqual([
      "alpha",
      "beta",
    ]);
    expect(body.bookCount).toBe(1); // book.epub; notes.txt ignored
  });

  it("hides dotfiles and dotdirs", async () => {
    asAdmin("a-1");
    const res = await GET(req(root));
    const body = await res.json();
    const names = body.dirs.map((d: { name: string }) => d.name);
    expect(names).not.toContain(".hidden");
    // dotfiles never reach bookCount or dirs at all
    expect(JSON.stringify(body)).not.toContain(".secret");
  });

  it("defaults to the jail root when no path param is given", async () => {
    asAdmin("a-1");
    const res = await GET(req()); // no ?path=
    expect(res.status).toBe(200);
    const body = await res.json();
    // same listing as explicitly asking for the root
    expect(body.dirs.map((d: { name: string }) => d.name)).toEqual([
      "alpha",
      "beta",
    ]);
    expect(body.parent).toBeNull();
  });

  it("parent is null when the target IS the jail root", async () => {
    asAdmin("a-1");
    const res = await GET(req(root));
    const body = await res.json();
    expect(body.parent).toBeNull();
  });

  it("parent points to the jail root (not above) for a subfolder", async () => {
    asAdmin("a-1");
    const res = await GET(req(path.join(root, "alpha")));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.parent).toBe(root);
  });

  it("rejects a '..' escape with the uniform 400", async () => {
    asAdmin("a-1");
    const res = await GET(req(path.join(root, "..")));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Can't read that directory" });
  });

  it("rejects an absolute out-of-jail path with the uniform 400", async () => {
    asAdmin("a-1");
    const res = await GET(req("/etc"));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Can't read that directory" });
  });

  it("nonexistent in-jail dir and out-of-jail path are INDISTINGUISHABLE", async () => {
    asAdmin("a-1");
    const missing = await GET(req(path.join(root, "does-not-exist")));
    const escaped = await GET(req("/etc"));
    expect(missing.status).toBe(escaped.status);
    expect(await missing.json()).toEqual(await escaped.json());
    expect(missing.status).toBe(400);
  });

  it("permission-denied and nonexistent in-jail dirs are INDISTINGUISHABLE", async () => {
    asAdmin("a-1");
    // A real unreadable directory inside the jail (chmod 000). Running as root
    // ignores mode bits, so skip the assertion in that case rather than lie.
    const locked = path.join(root, "locked");
    mkdirSync(locked, { recursive: true });
    chmodSync(locked, 0o000);
    try {
      const denied = await GET(req(locked));
      const missing = await GET(req(path.join(root, "still-not-here")));
      if (denied.status === 200) {
        // euid 0: mode bits don't apply, can't exercise EACCES here.
        return;
      }
      expect(denied.status).toBe(missing.status);
      expect(await denied.json()).toEqual(await missing.json());
      expect(denied.status).toBe(400);
    } finally {
      chmodSync(locked, 0o700);
      rmSync(locked, { recursive: true, force: true });
    }
  });

  it("never echoes the target path or an errno in an error body", async () => {
    asAdmin("a-1");
    const res = await GET(req("/etc/shadow"));
    const text = JSON.stringify(await res.json());
    expect(text).not.toContain("/etc");
    expect(text).not.toMatch(/ENOENT|EACCES|errno|ENOTDIR/);
  });
});

describe("GET /api/fs — admin gate", () => {
  it("403s a non-admin (reader) request", async () => {
    asReader("u-1");
    const res = await GET(req(root));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "forbidden" });
  });
});
